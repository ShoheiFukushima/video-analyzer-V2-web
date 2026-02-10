import express, { Request, Response } from 'express';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { execSync, spawn } from 'child_process';
import { CloudTasksClient } from '@google-cloud/tasks';
import { processVideo } from './services/videoProcessor.js';
import { getStatus, updateStatus } from './services/statusManager.js';
import { cleanupExpiredCheckpoints } from './services/checkpointService.js';

// Cloud Tasks client (initialized lazily)
let tasksClient: CloudTasksClient | null = null;

function getTasksClient(): CloudTasksClient {
  if (!tasksClient) {
    tasksClient = new CloudTasksClient();
  }
  return tasksClient;
}

// Cloud Tasks configuration
const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || 'video-analyzer-worker';
const LOCATION = 'us-central1';
const QUEUE_NAME = 'video-processing-queue';
const CLOUD_RUN_URL = process.env.CLOUD_RUN_SERVICE_URL ||
  `https://video-analyzer-worker-820467345033.${LOCATION}.run.app`;

dotenv.config();

// Track currently processing upload for graceful shutdown
let currentProcessingUploadId: string | null = null;
export let isShuttingDown = false;

/**
 * Set the currently processing upload ID (called by videoProcessor)
 */
export function setCurrentProcessingUpload(uploadId: string | null): void {
  currentProcessingUploadId = uploadId;
}

/**
 * Graceful shutdown handler - updates status for interrupted jobs
 */
async function handleShutdown(signal: string): Promise<void> {
  if (isShuttingDown) {
    console.log(`[Shutdown] Already shutting down, ignoring ${signal}`);
    return;
  }
  isShuttingDown = true;

  console.log(`[Shutdown] Received ${signal}, starting graceful shutdown...`);

  if (currentProcessingUploadId) {
    const uploadId = currentProcessingUploadId;
    console.log(`[${uploadId}] [Shutdown] Marking job as interrupted due to ${signal}`);

    // Determine error message based on signal
    let errorMessage: string;
    let errorCode: string;

    switch (signal) {
      case 'SIGTERM':
        // SIGTERM = Cloud Run is shutting down (deployment, scale-down, timeout approaching)
        errorMessage = 'Processing was interrupted due to server maintenance or scaling. Please try uploading again.';
        errorCode = 'SERVER_SHUTDOWN';
        break;
      case 'SIGINT':
        // SIGINT = Manual interruption (Ctrl+C in dev)
        errorMessage = 'Processing was manually stopped. Please try uploading again.';
        errorCode = 'MANUAL_STOP';
        break;
      case 'SIGKILL':
      case 'SIGBUS':
      case 'SIGSEGV':
        // These signals indicate memory/resource issues
        errorMessage = 'Processing was stopped due to resource constraints (memory or CPU). Please try with a smaller video or wait a moment and try again.';
        errorCode = 'RESOURCE_LIMIT';
        break;
      default:
        errorMessage = `Processing was interrupted unexpectedly (${signal}). Please try uploading again.`;
        errorCode = 'UNKNOWN_SIGNAL';
    }

    try {
      await updateStatus(uploadId, {
        status: 'error',
        error: errorMessage,
        metadata: {
          errorCode,
          signal,
          interruptedAt: new Date().toISOString(),
        } as any,
      });
      console.log(`[${uploadId}] [Shutdown] Status updated to error: ${errorCode}`);
    } catch (err) {
      console.error(`[${uploadId}] [Shutdown] Failed to update status:`, err);
    }
  } else {
    console.log('[Shutdown] No active job to mark as interrupted');
  }

  // Give some time for status update to complete
  setTimeout(() => {
    console.log('[Shutdown] Exiting process');
    process.exit(0);
  }, 1000);
}

// Register signal handlers for graceful shutdown
process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('SIGINT', () => handleShutdown('SIGINT'));

// Note: SIGKILL cannot be caught, but we can catch SIGBUS for memory issues
process.on('SIGBUS', () => handleShutdown('SIGBUS'));

// Uncaught exception handler - for runtime errors
process.on('uncaughtException', async (error) => {
  console.error('[UncaughtException]', error);

  if (currentProcessingUploadId && !isShuttingDown) {
    isShuttingDown = true;
    const uploadId = currentProcessingUploadId;
    console.log(`[${uploadId}] [UncaughtException] Marking job as failed`);

    try {
      await updateStatus(uploadId, {
        status: 'error',
        error: 'An unexpected error occurred during processing. Please try uploading again.',
        metadata: {
          errorCode: 'UNCAUGHT_EXCEPTION',
          errorMessage: error.message,
          interruptedAt: new Date().toISOString(),
        } as any,
      });
    } catch (err) {
      console.error(`[${uploadId}] [UncaughtException] Failed to update status:`, err);
    }
  }

  process.exit(1);
});

const app = express();
const port = process.env.PORT || 8080;

// Startup diagnostics for ffprobe
async function diagnoseFFprobe(): Promise<void> {
  console.log('═══════════════════════════════════════════════');
  console.log('🔍 FFprobe Startup Diagnostics');
  console.log('═══════════════════════════════════════════════');

  try {
    // Check which ffprobe
    const whichResult = execSync('which ffprobe 2>&1 || echo "not found"', { encoding: 'utf8' }).trim();
    console.log(`[Diag] which ffprobe: ${whichResult}`);

    if (whichResult === 'not found') {
      console.error('[Diag] ❌ ffprobe not found in PATH!');
      return;
    }

    // Check if file exists and is a symlink
    const lsResult = execSync(`ls -la ${whichResult} 2>&1 || echo "file not found"`, { encoding: 'utf8' }).trim();
    console.log(`[Diag] ls -la ffprobe: ${lsResult}`);

    // Check symlink target if it's a symlink
    const readlinkResult = execSync(`readlink -f ${whichResult} 2>&1 || echo "not a symlink"`, { encoding: 'utf8' }).trim();
    console.log(`[Diag] readlink -f: ${readlinkResult}`);

    // Check if the resolved path exists
    const resolvedExists = execSync(`ls -la ${readlinkResult} 2>&1 || echo "resolved path not found"`, { encoding: 'utf8' }).trim();
    console.log(`[Diag] resolved file: ${resolvedExists}`);

    // Check file type of resolved path (file command may not be installed)
    try {
      const fileResult = execSync(`file ${readlinkResult} 2>&1`, { encoding: 'utf8' }).trim();
      console.log(`[Diag] file type: ${fileResult}`);
    } catch (e) {
      console.log(`[Diag] file command failed (may not be installed)`);
    }

    // Check shared library dependencies
    try {
      const lddResult = execSync(`ldd ${whichResult} 2>&1 | head -30`, { encoding: 'utf8' }).trim();
      console.log(`[Diag] ldd (dependencies):\n${lddResult}`);

      // Check for missing libraries
      if (lddResult.includes('not found')) {
        console.error('[Diag] ❌ Missing shared libraries detected!');
      }
    } catch (e) {
      console.log(`[Diag] ldd command failed: ${e}`);
    }

    // Try running with strace to see what's happening
    try {
      console.log('[Diag] Attempting strace on ffprobe...');
      const straceResult = execSync('timeout 3 strace -f ffprobe -version 2>&1 | tail -50 || echo "strace timeout or not available"', { encoding: 'utf8' }).trim();
      console.log(`[Diag] strace output:\n${straceResult}`);
    } catch (e) {
      console.log(`[Diag] strace failed (may not be installed)`);
    }

    // Try running ffprobe -version with timeout
    console.log('[Diag] Testing ffprobe -version...');
    const startTime = Date.now();

    const result = await new Promise<string>((resolve, reject) => {
      const proc = spawn('ffprobe', ['-version'], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      proc.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      const timeout = setTimeout(() => {
        proc.kill('SIGKILL');
        reject(new Error('timeout'));
      }, 5000);

      proc.on('close', (code) => {
        clearTimeout(timeout);
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(`exit code ${code}: ${stderr}`));
        }
      });

      proc.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    const duration = Date.now() - startTime;
    const version = result.split('\n')[0];
    console.log(`[Diag] ✅ ffprobe works: ${version} (${duration}ms)`);

  } catch (error) {
    console.error(`[Diag] ❌ ffprobe test failed:`, error);

    // Additional diagnostics on failure
    try {
      console.log('[Diag] Checking /usr/bin contents...');
      const binList = execSync('ls -la /usr/bin/ff* 2>&1 || echo "no ff* files"', { encoding: 'utf8' }).trim();
      console.log(`[Diag] /usr/bin/ff*:\n${binList}`);

      console.log('[Diag] Checking PATH...');
      console.log(`[Diag] PATH: ${process.env.PATH}`);

      console.log('[Diag] Checking dpkg for ffmpeg...');
      const dpkgResult = execSync('dpkg -l | grep -i ffmpeg 2>&1 || echo "ffmpeg not in dpkg"', { encoding: 'utf8' }).trim();
      console.log(`[Diag] dpkg ffmpeg: ${dpkgResult}`);
    } catch (diagError) {
      console.error('[Diag] Additional diagnostics failed:', diagError);
    }
  }

  console.log('═══════════════════════════════════════════════');
}

// Run diagnostics at startup
diagnoseFFprobe().catch(console.error);
const workerSecret = process.env.WORKER_SECRET;

// In-memory storage for result file paths (development only)
export const resultFileMap = new Map<string, string>();

// Middleware
app.use(express.json({ limit: '10mb' }));

// Authentication middleware
const validateAuth = (req: Request, res: Response, next: Function): void => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.replace('Bearer ', '');

  if (!token || token !== workerSecret) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  next();
};

// Build info (loaded at startup)
let buildInfo: { buildTime: string; buildTimeJST: string; commit?: string } = {
  buildTime: new Date().toISOString(),
  buildTimeJST: new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }),
};

// Try to load build-info.json if it exists (created during build)
// Check multiple locations: dist/, cwd(), and same directory as the script
try {
  const possiblePaths = [
    path.join(process.cwd(), 'dist', 'build-info.json'),  // Cloud Run: /app/dist/build-info.json
    path.join(process.cwd(), 'build-info.json'),          // Local development
    path.join(path.dirname(new URL(import.meta.url).pathname), 'build-info.json'),  // Same as script
  ];

  for (const buildInfoPath of possiblePaths) {
    if (fs.existsSync(buildInfoPath)) {
      buildInfo = JSON.parse(fs.readFileSync(buildInfoPath, 'utf-8'));
      console.log(`[BuildInfo] Loaded from ${buildInfoPath}`);
      break;
    }
  }
} catch (e) {
  console.log('[BuildInfo] No build-info.json found, using startup time');
}

// Health check endpoint with build info (CORS enabled for frontend)
app.get('/health', (req: Request, res: Response) => {
  // Allow cross-origin requests from frontend
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const revision = process.env.K_REVISION || 'local';
  res.json({
    status: 'ok',
    revision,
    buildTime: buildInfo.buildTime,
    buildTimeJST: buildInfo.buildTimeJST,
    commit: buildInfo.commit || 'unknown',
    timestamp: new Date().toISOString(),
  });
});

// Diagnostic endpoint - tests ffprobe after downloading a sample video
// This simulates the actual processing flow to verify ffprobe works post-download
app.get('/diag/ffprobe-test', async (req: Request, res: Response) => {
  const { getVideoMetadata } = await import('./services/ffmpeg.js');
  const axios = (await import('axios')).default;
  const fs = await import('fs/promises');
  const path = await import('path');

  const startTime = Date.now();
  const testVideoUrl = 'https://www.w3schools.com/html/mov_bbb.mp4'; // Small test video (1.6MB)
  const testFilePath = path.join('/tmp', `diag-test-${Date.now()}.mp4`);

  try {
    console.log('[Diag] Starting ffprobe test after download...');

    // Step 1: Download the test video
    console.log('[Diag] Downloading test video...');
    const response = await axios.get(testVideoUrl, {
      responseType: 'arraybuffer',
      timeout: 30000,
    });
    await fs.writeFile(testFilePath, Buffer.from(response.data));
    const downloadTime = Date.now() - startTime;
    console.log(`[Diag] Downloaded ${response.data.length} bytes in ${downloadTime}ms`);

    // Step 2: fsync to ensure data is written
    const fd = await fs.open(testFilePath, 'r');
    // @ts-ignore - fsync exists but may not be in types
    if (fd.sync) await fd.sync();
    await fd.close();
    console.log('[Diag] File synced to disk');

    // Step 3: Run ffprobe
    console.log('[Diag] Running ffprobe...');
    const metadata = await getVideoMetadata(testFilePath);
    const totalTime = Date.now() - startTime;

    // Cleanup
    await fs.unlink(testFilePath).catch(() => {});

    console.log(`[Diag] ✅ ffprobe test PASSED in ${totalTime}ms`);
    res.json({
      status: 'ok',
      message: 'ffprobe works after download',
      metadata,
      timing: {
        downloadMs: downloadTime,
        totalMs: totalTime,
      }
    });
  } catch (error: any) {
    const totalTime = Date.now() - startTime;
    console.error(`[Diag] ❌ ffprobe test FAILED after ${totalTime}ms:`, error.message);

    // Cleanup on error
    await fs.unlink(testFilePath).catch(() => {});

    res.status(500).json({
      status: 'error',
      message: error.message,
      timing: {
        totalMs: totalTime,
      }
    });
  }
});

// Diagnostic endpoint - tests scene detection with FFmpeg spawn
// Verifies the spawn-based scene detection works in gVisor environment
app.get('/diag/scene-detection-test', async (req: Request, res: Response) => {
  const { getVideoMetadata, extractScenesWithFrames, cleanupFrames } = await import('./services/ffmpeg.js');
  const axios = (await import('axios')).default;
  const fs = await import('fs/promises');
  const path = await import('path');

  const startTime = Date.now();
  const testVideoUrl = 'https://www.w3schools.com/html/mov_bbb.mp4'; // Small test video (1.6MB)
  const testFilePath = path.join('/tmp', `diag-scene-test-${Date.now()}.mp4`);

  try {
    console.log('[Diag-Scene] Starting scene detection test after download...');

    // Step 1: Download the test video
    console.log('[Diag-Scene] Downloading test video...');
    const response = await axios.get(testVideoUrl, {
      responseType: 'arraybuffer',
      timeout: 30000,
    });
    await fs.writeFile(testFilePath, Buffer.from(response.data));
    const downloadTime = Date.now() - startTime;
    console.log(`[Diag-Scene] Downloaded ${response.data.length} bytes in ${downloadTime}ms`);

    // Step 2: Get metadata
    console.log('[Diag-Scene] Getting video metadata...');
    const metadataStartTime = Date.now();
    const metadata = await getVideoMetadata(testFilePath);
    const metadataTime = Date.now() - metadataStartTime;
    console.log(`[Diag-Scene] Metadata extracted in ${metadataTime}ms`);

    // Step 3: Run scene detection
    console.log('[Diag-Scene] Running scene detection...');
    const sceneStartTime = Date.now();
    const scenes = await extractScenesWithFrames(testFilePath, undefined, metadata);
    const sceneTime = Date.now() - sceneStartTime;
    console.log(`[Diag-Scene] Scene detection completed in ${sceneTime}ms`);

    // Cleanup
    await cleanupFrames(scenes);
    await fs.unlink(testFilePath).catch(() => {});

    const totalTime = Date.now() - startTime;
    console.log(`[Diag-Scene] ✅ Scene detection test PASSED in ${totalTime}ms`);

    res.json({
      status: 'ok',
      message: 'Scene detection works after download',
      metadata,
      scenes: scenes.map(s => ({
        sceneNumber: s.sceneNumber,
        startTime: s.startTime,
        endTime: s.endTime,
        midTime: s.midTime,
        timecode: s.timecode
      })),
      timing: {
        downloadMs: downloadTime,
        metadataMs: metadataTime,
        sceneDetectionMs: sceneTime,
        totalMs: totalTime,
      }
    });
  } catch (error: any) {
    const totalTime = Date.now() - startTime;
    console.error(`[Diag-Scene] ❌ Scene detection test FAILED after ${totalTime}ms:`, error.message);

    // Cleanup on error
    await fs.unlink(testFilePath).catch(() => {});

    res.status(500).json({
      status: 'error',
      message: error.message,
      timing: {
        totalMs: totalTime,
      }
    });
  }
});

// Process video endpoint - Creates a Cloud Task for reliable processing
// This ensures the processing request is durable and will be retried if needed
app.post('/process', validateAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { uploadId, r2Key, fileName, userId, dataConsent, detectionMode } = req.body;

    // Security: Validate required fields including userId for IDOR protection
    if (!uploadId || !r2Key || !userId) {
      res.status(400).json({
        error: 'Invalid request',
        message: 'Missing uploadId, r2Key, or userId'
      });
      return;
    }

    // Validate detectionMode (default to 'standard' if not provided or invalid)
    const validModes = ['standard', 'enhanced'];
    const mode = validModes.includes(detectionMode) ? detectionMode : 'standard';

    console.log(`[${uploadId}] Creating Cloud Task for video processing`, {
      fileName,
      userId,
      r2Key,
      detectionMode: mode
    });

    // Create a Cloud Task to process the video
    // This ensures the processing is durable and will be retried if the instance is terminated
    const client = getTasksClient();
    const parent = client.queuePath(PROJECT_ID, LOCATION, QUEUE_NAME);

    const taskPayload = {
      uploadId,
      r2Key,
      fileName,
      userId,
      dataConsent: dataConsent || false,
      detectionMode: mode,
    };

    const task = {
      httpRequest: {
        httpMethod: 'POST' as const,
        url: `${CLOUD_RUN_URL}/process-task`,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.WORKER_SECRET}`,
        },
        body: Buffer.from(JSON.stringify(taskPayload)).toString('base64'),
      },
      // Task dispatch deadline: 30 minutes (Cloud Tasks max is 30 mins)
      // Cloud Run will handle the actual timeout (up to 60 mins)
      dispatchDeadline: { seconds: 1800 },
    };

    const [response] = await client.createTask({ parent, task });
    console.log(`[${uploadId}] Cloud Task created: ${response.name}`);

    // Return immediately - Cloud Tasks will handle the processing
    res.json({
      success: true,
      uploadId,
      message: 'Video processing task created',
      status: 'processing',
      detectionMode: mode,
      taskName: response.name,
    });
  } catch (error) {
    console.error('[Process endpoint] Error:', error);
    res.status(500).json({
      error: 'Server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Process task endpoint - Called by Cloud Tasks
// This endpoint awaits the processing, ensuring Cloud Run keeps the instance alive
app.post('/process-task', validateAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { uploadId, r2Key, fileName, userId, dataConsent, detectionMode } = req.body;

    // Security: Validate required fields
    if (!uploadId || !r2Key || !userId) {
      res.status(400).json({
        error: 'Invalid request',
        message: 'Missing uploadId, r2Key, or userId'
      });
      return;
    }

    const mode = detectionMode || 'standard';

    console.log(`[${uploadId}] Processing video (Cloud Task)`, {
      fileName,
      userId,
      r2Key,
      detectionMode: mode
    });

    // AWAIT the processing - this keeps the HTTP connection open
    // Cloud Tasks will wait for this to complete (up to 30 minutes)
    await processVideo(uploadId, r2Key, fileName, userId, dataConsent, mode);

    console.log(`[${uploadId}] Processing completed successfully`);

    res.json({
      success: true,
      uploadId,
      message: 'Video processing completed',
      status: 'completed',
    });
  } catch (error) {
    console.error('[Process-task endpoint] Error:', error);

    // Return 500 to signal Cloud Tasks to retry (if retries are configured)
    res.status(500).json({
      error: 'Processing failed',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get status endpoint
app.get('/status/:uploadId', validateAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { uploadId } = req.params;
    const status = await getStatus(uploadId);

    if (!status) {
      res.status(404).json({ error: 'Upload not found' });
      return;
    }

    res.json(status);
  } catch (error) {
    console.error('[Status endpoint] Error:', error);
    res.status(500).json({
      error: 'Server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Download result endpoint (development mode)
app.get('/result/:uploadId', validateAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { uploadId } = req.params;

    console.log(`[${uploadId}] Result download requested`);

    // Try to get file path from memory map first
    let filePath = resultFileMap.get(uploadId);

    // If not in memory map (e.g., after worker restart), fallback to filesystem
    if (!filePath) {
      console.log(`[${uploadId}] Not found in memory map, checking filesystem...`);
      const expectedPath = path.join('/tmp', `result_${uploadId}.xlsx`);

      if (fs.existsSync(expectedPath)) {
        filePath = expectedPath;
        console.log(`[${uploadId}] Found file on disk: ${filePath}`);
      } else {
        console.error(`[${uploadId}] Result file not found in memory map or disk`);
        res.status(404).json({ error: 'Result not found' });
        return;
      }
    }

    // Check if file exists
    if (!fs.existsSync(filePath)) {
      console.error(`[${uploadId}] Result file not found on disk: ${filePath}`);
      res.status(404).json({ error: 'Result file not found' });
      return;
    }

    console.log(`[${uploadId}] Sending result file: ${path.basename(filePath)}`);

    // Set headers for file download
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${path.basename(filePath)}"`);

    // Stream file to response
    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);

    fileStream.on('error', (error) => {
      console.error(`[${uploadId}] File stream error:`, error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to stream file' });
      }
    });

  } catch (error) {
    console.error('[Result endpoint] Error:', error);
    if (!res.headersSent) {
      res.status(500).json({
        error: 'Server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
});

// Cron endpoint for cleaning up expired checkpoints
// This should be called daily by Cloud Scheduler
app.post('/cron/cleanup-checkpoints', validateAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    console.log('[Cron] Starting expired checkpoint cleanup...');
    const deletedCount = await cleanupExpiredCheckpoints();
    console.log(`[Cron] Checkpoint cleanup complete: ${deletedCount} expired checkpoints removed`);

    res.json({
      success: true,
      message: 'Checkpoint cleanup complete',
      deletedCount,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[Cron] Checkpoint cleanup error:', error);
    res.status(500).json({
      error: 'Cleanup failed',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Environment validation
const requiredEnvVars = [
  'WORKER_SECRET',
  'GEMINI_API_KEY',
  'OPENAI_API_KEY',
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET_NAME',
];
const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingEnvVars.length > 0) {
  console.warn('[Cloud Run Worker] Missing environment variables:', missingEnvVars.join(', '));
  console.warn('[Cloud Run Worker] Some features may not work properly');
}

// Error handling
app.use((err: Error, req: Request, res: Response, next: Function) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'An error occurred'
  });
});

app.listen(port, () => {
  console.log(`[Cloud Run Worker] Server running on port ${port}`);
  console.log(`[Cloud Run Worker] NODE_ENV: ${process.env.NODE_ENV}`);
});
