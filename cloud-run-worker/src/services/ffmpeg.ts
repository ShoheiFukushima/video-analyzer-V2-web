/**
 * FFmpeg Utility Service
 * Frame extraction, video metadata, and scene range generation.
 * Scene detection is handled by PySceneDetect (pysceneDetector.ts).
 */

import ffmpeg from 'fluent-ffmpeg';
import { promises as fs } from 'fs';
import path from 'path';
import { spawn, execSync } from 'child_process';
import pLimit from 'p-limit';
import { Scene, SceneCut, VideoMetadata } from '../types/excel.js';
import { formatTimecode } from '../utils/timecode.js';
import { TIMEOUTS } from '../config/timeouts.js';
import type { TelopAnimation, PanAnimation } from './pysceneDetector.js';

// Concurrency limit for parallel frame extraction
// Balanced for 4 vCPU Cloud Run instance
const FRAME_EXTRACTION_CONCURRENCY = 10;

/**
 * Progress callback for scene detection
 * @param currentTime - Current position in seconds
 * @param totalDuration - Total video duration in seconds
 * @param formattedProgress - Formatted string like "45:30 / 2:00:00"
 */
export type SceneDetectionProgressCallback = (
  currentTime: number,
  totalDuration: number,
  formattedProgress: string
) => void;

/**
 * Format seconds to MM:SS or H:MM:SS format
 */
function formatTimeForProgress(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Parse FFmpeg time string (HH:MM:SS.ss or MM:SS.ss) to seconds
 */
function parseFFmpegTime(timeStr: string): number | null {
  const match = timeStr.match(/(\d+):(\d+):(\d+\.?\d*)|(\d+):(\d+\.?\d*)/);
  if (!match) return null;

  if (match[1] !== undefined) {
    // HH:MM:SS format
    return parseInt(match[1]) * 3600 + parseInt(match[2]) * 60 + parseFloat(match[3]);
  } else if (match[4] !== undefined) {
    // MM:SS format
    return parseInt(match[4]) * 60 + parseFloat(match[5]);
  }
  return null;
}

// Scene detection is handled by PySceneDetect (pysceneDetector.ts)
// FFmpeg is used only for frame extraction and metadata



/**
 * Generate scene ranges from detected cuts
 * Calculates mid-point (50% between scene detection points)
 * @param cuts - Array of scene cuts
 * @param videoDuration - Total video duration in seconds
 * @param config - Scene detection configuration
 * @returns Array of scene ranges with mid-points
 */
async function generateSceneRanges(
  cuts: SceneCut[],
  videoDuration: number,
  minSceneDuration: number = 0.2,
  telopAnimations: TelopAnimation[] = [],
  panAnimations: PanAnimation[] = []
): Promise<Scene[]> {
  const scenes: Scene[] = [];
  let sceneNumber = 1;
  let telopAdjustCount = 0;
  let panAdjustCount = 0;

  console.log(`📐 Generating scene ranges from ${cuts.length} cuts...`);
  if (telopAnimations.length > 0) {
    console.log(`  🎯 Telop animations: ${telopAnimations.length} regions for midTime avoidance`);
  }
  if (panAnimations.length > 0) {
    console.log(`  📷 Camera pans: ${panAnimations.length} regions for midTime avoidance`);
  }

  for (let i = 0; i < cuts.length; i++) {
    const startTime = cuts[i].timestamp;
    const endTime = i < cuts.length - 1 ? cuts[i + 1].timestamp : videoDuration;
    const duration = endTime - startTime;

    // Filter out very short scenes
    // Note: sceneNumber increments ONLY for valid scenes (duration >= minSceneDuration)
    // This ensures sequential numbering (1, 2, 3...) even when short scenes are skipped
    if (duration < minSceneDuration) {
      console.log(`  ⏭️  Skipping short scene (${duration.toFixed(2)}s < ${minSceneDuration}s)`);
      continue;  // Skip without consuming a scene number
    }

    // Scene 1: always use 0 frame (avoids telop animation at start)
    // Other scenes: 50% midpoint
    const isDissolve = cuts[i].detectionReason === 'dissolve_transition';
    const dissolveStart = cuts[i].dissolveStart;
    const dissolveEnd = cuts[i].dissolveEnd;
    let midTime = (i === 0) ? 0 : startTime + (endTime - startTime) * 0.5;

    // Debug: Log scene details for dissolve diagnosis
    if (i > 0) {
      const nextCut = i < cuts.length - 1 ? cuts[i + 1] : null;
      console.log(`  📊 Scene ${sceneNumber}: start=${startTime.toFixed(2)}s end=${endTime.toFixed(2)}s midTime=${midTime.toFixed(2)}s` +
        (isDissolve ? ` [dissolve: ${dissolveStart?.toFixed(2)}-${dissolveEnd?.toFixed(2)}]` : '') +
        (nextCut?.detectionReason === 'dissolve_transition' ? ` [next dissolve: ${nextCut.dissolveStart?.toFixed(2)}-${nextCut.dissolveEnd?.toFixed(2)}]` : ''));
    }

    // Telop animation avoidance: shift midTime if it falls within an animation region
    if (i > 0 && telopAnimations.length > 0) {
      for (const ta of telopAnimations) {
        if (midTime >= ta.start && midTime <= ta.settling) {
          const afterSettling = ta.settling + 0.2;
          const beforeStart = ta.start - 0.2;
          if (afterSettling < endTime) {
            console.log(`  🎯 Scene ${sceneNumber}: midTime ${midTime.toFixed(2)}s in telop animation (${ta.region} ${ta.start.toFixed(2)}-${ta.settling.toFixed(2)}s) → shifted to ${afterSettling.toFixed(2)}s`);
            midTime = afterSettling;
          } else if (beforeStart > startTime) {
            console.log(`  🎯 Scene ${sceneNumber}: midTime ${midTime.toFixed(2)}s in telop animation (${ta.region} ${ta.start.toFixed(2)}-${ta.settling.toFixed(2)}s) → shifted to ${beforeStart.toFixed(2)}s`);
            midTime = beforeStart;
          }
          // else: no safe position, keep original midTime
          telopAdjustCount++;
          break; // Only adjust for the first overlapping animation
        }
      }
    }

    // Camera pan avoidance: shift midTime if it falls within a pan region
    if (i > 0 && panAnimations.length > 0) {
      for (const pa of panAnimations) {
        if (midTime >= pa.start && midTime <= pa.settling) {
          const afterSettling = pa.settling + 0.2;
          const beforeStart = pa.start - 0.2;
          if (afterSettling < endTime) {
            console.log(`  📷 Scene ${sceneNumber}: midTime ${midTime.toFixed(2)}s in camera pan (${pa.direction} ${pa.start.toFixed(2)}-${pa.settling.toFixed(2)}s) → shifted to ${afterSettling.toFixed(2)}s`);
            midTime = afterSettling;
          } else if (beforeStart > startTime) {
            console.log(`  📷 Scene ${sceneNumber}: midTime ${midTime.toFixed(2)}s in camera pan (${pa.direction} ${pa.start.toFixed(2)}-${pa.settling.toFixed(2)}s) → shifted to ${beforeStart.toFixed(2)}s`);
            midTime = beforeStart;
          }
          // else: no safe position, keep original midTime
          panAdjustCount++;
          break; // Only adjust for the first overlapping pan
        }
      }
    }

    scenes.push({
      sceneNumber,
      startTime, // Detection point A (前のカット点)
      endTime, // Detection point B (次のカット点)
      midTime, // Screenshot capture point
      timecode: formatTimecode(startTime),
      ...(isDissolve ? { detectionReason: 'dissolve_transition' as const } : {}),
      ...(dissolveStart != null ? { dissolveStart } : {}),
      ...(dissolveEnd != null ? { dissolveEnd } : {}),
    });

    sceneNumber++;
  }

  console.log(`✅ Generated ${scenes.length} valid scene ranges`);
  if (telopAdjustCount > 0) {
    console.log(`  🎯 Adjusted ${telopAdjustCount} midTimes to avoid telop animations`);
  }
  if (panAdjustCount > 0) {
    console.log(`  📷 Adjusted ${panAdjustCount} midTimes to avoid camera pans`);
  }
  return scenes;
}

/**
 * Extract frame at specific timestamp with adaptive quality optimization
 * Uses spawn directly with gVisor-compatible environment settings
 * @param videoPath - Path to the video file
 * @param timestamp - Time in seconds
 * @param outputPath - Output file path for frame
 * @param videoMetadata - Optional video metadata for adaptive resizing
 */
export async function extractFrameAtTime(
  videoPath: string,
  timestamp: number,
  outputPath: string,
  videoMetadata?: VideoMetadata,
  targetWidth?: number
): Promise<void> {
  return new Promise((resolve, reject) => {
    const TIMEOUT_MS = 60000; // 60 seconds for frame extraction
    let completed = false;

    // Build filter chain
    const filters: string[] = [];

    if (targetWidth) {
      // Reduced resolution for Excel embedding (e.g., 320px wide)
      filters.push(`scale=${targetWidth}:-1`);
    } else {
      // Adaptive resolution: maintain original if <= 1920x1080, otherwise resize
      const shouldResize = videoMetadata &&
        (videoMetadata.width > 1920 || videoMetadata.height > 1080);
      if (shouldResize) {
        filters.push('scale=1920:1080:force_original_aspect_ratio=decrease');
      }
      // Sharpness filter for OCR clarity (not needed for Excel display)
      filters.push('unsharp=5:5:1.0:5:5:0.0');
    }

    // Set gVisor-compatible environment
    const ffmpegEnv = {
      ...process.env,
      FONTCONFIG_PATH: '',
      FONTCONFIG_FILE: '/dev/null',
      FC_DEBUG: '0',
      HOME: '/tmp',
      XDG_CACHE_HOME: '/tmp',
      XDG_CONFIG_HOME: '/tmp',
      FFREPORT: '',
      AV_LOG_FORCE_NOCOLOR: '1',
    };

    const ffmpegArgs = [
      '-nostdin',
      '-y',
      '-ss', timestamp.toString(),
      '-i', videoPath,
      '-frames:v', '1',
      '-vf', filters.join(','),
      '-pix_fmt', 'rgb24',
      outputPath
    ];

    const proc = spawn('ffmpeg', ffmpegArgs, {
      env: ffmpegEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let lastActivityTime = Date.now();

    // Timeout handler
    const timeoutId = setTimeout(() => {
      if (!completed) {
        completed = true;
        proc.kill('SIGKILL');
        reject(new Error(`Frame extraction timed out after ${TIMEOUT_MS}ms at ${timestamp}s`));
      }
    }, TIMEOUT_MS);

    // Activity watchdog
    const activityInterval = setInterval(() => {
      const idleTime = Date.now() - lastActivityTime;
      if (idleTime > 30000) { // 30 seconds idle for frame extraction
        if (!completed) {
          completed = true;
          clearTimeout(timeoutId);
          clearInterval(activityInterval);
          proc.kill('SIGKILL');
          reject(new Error(`Frame extraction stalled (no output for ${idleTime / 1000}s)`));
        }
      }
    }, 5000);

    proc.stdout?.on('data', () => {
      lastActivityTime = Date.now();
    });

    proc.stderr?.on('data', () => {
      lastActivityTime = Date.now();
    });

    proc.on('close', (code) => {
      if (completed) return;
      completed = true;
      clearTimeout(timeoutId);
      clearInterval(activityInterval);

      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Frame extraction failed with code ${code} at ${timestamp}s`));
      }
    });

    proc.on('error', (err) => {
      if (completed) return;
      completed = true;
      clearTimeout(timeoutId);
      clearInterval(activityInterval);
      reject(new Error(`Frame extraction spawn error: ${err.message}`));
    });
  });
}

// ============================================================
// Frame Sharpness Check (Blur Detection)
// Uses Python+OpenCV (already in Docker image for PySceneDetect)
// ============================================================

/** Minimum Laplacian variance to consider a frame "sharp" (160x120 grayscale) */
const DEFAULT_SHARPNESS_THRESHOLD = 100;

/** How many candidate positions to try when a frame is blurry */
const BLUR_RETRY_OFFSETS = [0.25, 0.90, 0.15, 0.75]; // ratios within scene duration

// ============================================================
// Dissolve Detection Thresholds (Phase A: logging only)
// ============================================================
const DEFAULT_DISSOLVE_EDGE_RATIO_THRESHOLD = 0.08;
const DEFAULT_DISSOLVE_LOCAL_CONTRAST_THRESHOLD = 25.0;

/**
 * Frame quality metrics for dissolve detection
 */
interface FrameQuality {
  sharpness: number;      // Laplacian variance (existing metric)
  edgeRatio: number;      // Canny edge pixel ratio (0.0-1.0)
  localContrast: number;  // Mean of 8x8 patch standard deviations
}

/**
 * Measure frame sharpness using Laplacian variance via Python+OpenCV.
 * Returns a numeric sharpness score (higher = sharper).
 * Typical values: <100 = blurry (dissolve), 200-1000+ = sharp.
 *
 * @param imagePath - Path to PNG frame file
 * @returns Laplacian variance score
 */
async function measureFrameSharpness(imagePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const pythonPath = process.env.PYSCENE_PYTHON_PATH || '/opt/venv/bin/python3';
    const script = `
import cv2, sys
img = cv2.imread(sys.argv[1])
if img is None:
    print("0.0")
    sys.exit(0)
gray = cv2.cvtColor(cv2.resize(img, (160, 120)), cv2.COLOR_BGR2GRAY)
print(f"{cv2.Laplacian(gray, cv2.CV_64F).var():.2f}")
`.trim();

    const proc = spawn(pythonPath, ['-c', script, imagePath], {
      timeout: 10000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data: Buffer) => { stdout += data.toString(); });
    proc.stderr?.on('data', (data: Buffer) => { stderr += data.toString(); });

    proc.on('close', (code) => {
      if (code === 0 && stdout.trim()) {
        const score = parseFloat(stdout.trim());
        if (!isNaN(score)) {
          resolve(score);
          return;
        }
      }
      // On error, return 0 (will trigger retry) but don't fail the pipeline
      console.warn(`⚠️ Sharpness check failed (code=${code}): ${stderr.trim()}`);
      resolve(0);
    });

    proc.on('error', (err) => {
      console.warn(`⚠️ Sharpness check spawn error: ${err.message}`);
      resolve(0);
    });
  });
}


/**
 * Measure frame quality with multiple metrics for dissolve detection.
 * Returns sharpness (Laplacian variance), edge ratio (Canny), and local contrast
 * in a single Python+OpenCV call.
 *
 * Phase A: Used for logging metrics to calibrate dissolve thresholds.
 *
 * @param imagePath - Path to PNG frame file
 * @returns FrameQuality metrics
 */
async function measureFrameQuality(imagePath: string): Promise<FrameQuality> {
  return new Promise((resolve) => {
    const pythonPath = process.env.PYSCENE_PYTHON_PATH || '/opt/venv/bin/python3';
    const script = `
import cv2, sys, json
import numpy as np
img = cv2.imread(sys.argv[1])
if img is None:
    print(json.dumps({"sharpness": 0, "edgeRatio": 0, "localContrast": 0}))
    sys.exit(0)
gray = cv2.cvtColor(cv2.resize(img, (160, 120)), cv2.COLOR_BGR2GRAY)
sharpness = float(cv2.Laplacian(gray, cv2.CV_64F).var())
edges = cv2.Canny(gray, 50, 150)
edge_ratio = float(edges.sum() / 255) / (160 * 120)
h, w = gray.shape
patch_stds = []
for y in range(0, h - 7, 8):
    for x in range(0, w - 7, 8):
        patch_stds.append(float(gray[y:y+8, x:x+8].std()))
local_contrast = float(np.mean(patch_stds))
print(json.dumps({"sharpness": round(sharpness, 2), "edgeRatio": round(edge_ratio, 4), "localContrast": round(local_contrast, 2)}))
`.trim();

    const proc = spawn(pythonPath, ['-c', script, imagePath], {
      timeout: 15000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data: Buffer) => { stdout += data.toString(); });
    proc.stderr?.on('data', (data: Buffer) => { stderr += data.toString(); });

    proc.on('close', (code) => {
      if (code === 0 && stdout.trim()) {
        try {
          const result = JSON.parse(stdout.trim());
          if (typeof result.sharpness === 'number' &&
              typeof result.edgeRatio === 'number' &&
              typeof result.localContrast === 'number') {
            resolve(result as FrameQuality);
            return;
          }
        } catch {
          // JSON parse failed, fall through
        }
      }
      console.warn(`⚠️ Frame quality check failed (code=${code}): ${stderr.trim()}`);
      resolve({ sharpness: 0, edgeRatio: 0, localContrast: 0 });
    });

    proc.on('error', (err) => {
      console.warn(`⚠️ Frame quality check spawn error: ${err.message}`);
      resolve({ sharpness: 0, edgeRatio: 0, localContrast: 0 });
    });
  });
}

/**
 * Quick check if ffprobe is working
 */
async function checkFfprobeAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn('ffprobe', ['-version'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 5000,
    });

    let output = '';
    proc.stdout?.on('data', (data) => {
      output += data.toString();
    });

    proc.on('close', (code) => {
      if (code === 0 && output.includes('ffprobe')) {
        console.log(`[Metadata] ffprobe available: ${output.split('\n')[0]}`);
        resolve(true);
      } else {
        console.error(`[Metadata] ffprobe not available or failed`);
        resolve(false);
      }
    });

    proc.on('error', () => {
      console.error(`[Metadata] ffprobe spawn error`);
      resolve(false);
    });

    // Timeout fallback
    setTimeout(() => {
      proc.kill();
      resolve(false);
    }, 5000);
  });
}

/**
 * Quick diagnostic: verify ffprobe binary works
 * Uses execSync with shell timeout for reliable timeout control
 * Returns version string if working, throws if not
 */
function verifyFfprobeWorks(): string {
  try {
    // Use shell timeout command for reliable timeout
    // This works because we added 'timeout' via coreutils in the Dockerfile
    const result = execSync('timeout 5s ffprobe -version 2>&1', {
      encoding: 'utf8',
      timeout: 10000, // Node.js level backup timeout
      maxBuffer: 1024 * 1024,
    });

    if (result.includes('ffprobe version')) {
      return result.split('\n')[0];
    } else {
      throw new Error(`Unexpected ffprobe output: ${result.substring(0, 100)}`);
    }
  } catch (err: any) {
    // Check if it's a timeout (exit code 124 from timeout command)
    if (err.status === 124) {
      throw new Error('ffprobe -version timed out after 5s (shell timeout)');
    }
    // Check if Node.js timeout triggered
    if (err.killed) {
      throw new Error('ffprobe -version timed out after 10s (node timeout)');
    }
    throw new Error(`ffprobe verification failed: ${err.message}`);
  }
}

/**
 * Get video metadata (duration, width, height, aspect ratio)
 * Uses fluent-ffmpeg's ffprobe with gVisor-compatible environment settings
 */
export async function getVideoMetadata(videoPath: string): Promise<VideoMetadata> {
  const TIMEOUT_MS = TIMEOUTS.METADATA_EXTRACTION; // 60 seconds

  console.log(`[Metadata] Starting metadata extraction for: ${videoPath}`);

  // Check if file exists and log basic info
  try {
    const stats = await fs.stat(videoPath);
    console.log(`[Metadata] File size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
  } catch (err) {
    console.error(`[Metadata] File not accessible: ${videoPath}`);
    throw new Error(`Video file not accessible: ${videoPath}`);
  }

  return new Promise((resolve, reject) => {
    let completed = false;

    // Set timeout
    const timeoutId = setTimeout(() => {
      if (!completed) {
        completed = true;
        console.error(`[Metadata] ffprobe timed out after ${TIMEOUT_MS / 1000}s`);
        reject(new Error(`ffprobe metadata extraction timed out after ${TIMEOUT_MS / 1000}s`));
      }
    }, TIMEOUT_MS);

    console.log(`[Metadata] Using fluent-ffmpeg ffprobe...`);

    // Use fluent-ffmpeg's ffprobe with custom options
    // Set environment variables to avoid gVisor issues
    const originalEnv = process.env;
    process.env = {
      ...originalEnv,
      FONTCONFIG_PATH: '',        // Disable fontconfig (common hang cause)
      FONTCONFIG_FILE: '/dev/null',
      FC_DEBUG: '0',
      HOME: '/tmp',               // Avoid writing to non-existent home
      XDG_CACHE_HOME: '/tmp',
      FFREPORT: '',               // Disable ffmpeg reporting
    };

    ffmpeg.ffprobe(videoPath, [
      '-probesize', '5000000',      // Limit probe size
      '-analyzeduration', '5000000', // Limit analysis duration
    ], (err: Error | null, metadata: any) => {
      // Restore original environment
      process.env = originalEnv;

      if (completed) return;
      completed = true;
      clearTimeout(timeoutId);

      if (err) {
        console.error(`[Metadata] ffprobe error: ${err.message}`);
        reject(new Error(`ffprobe failed: ${err.message}`));
        return;
      }

      try {
        const duration = Math.floor(metadata.format?.duration || 0);
        const videoStream = metadata.streams?.find((s: any) => s.codec_type === 'video');

        if (!videoStream || !videoStream.width || !videoStream.height) {
          reject(new Error('Could not extract video dimensions from metadata'));
          return;
        }

        const width = videoStream.width;
        const height = videoStream.height;
        const aspectRatio = width / height;

        console.log(`📹 Video Metadata: ${width}x${height} (${aspectRatio.toFixed(2)}:1), ${duration}s`);

        resolve({
          width,
          height,
          aspectRatio,
          duration
        });
      } catch (parseError) {
        console.error(`[Metadata] Parse error: ${parseError}`);
        reject(new Error(`Failed to parse ffprobe output: ${parseError}`));
      }
    });
  });
}

/**
 * Clean up temporary frame files
 * @param scenes - Array of scenes with screenshot paths
 */
export async function cleanupFrames(scenes: Scene[]): Promise<void> {
  if (scenes.length === 0 || !scenes[0].screenshotPath) return;

  const outputDir = path.dirname(scenes[0].screenshotPath);

  try {
    await fs.rm(outputDir, { recursive: true, force: true });
    console.log(`🧹 Cleaned up temporary frames: ${outputDir}`);
  } catch (error) {
    console.error('⚠️ Error cleaning up frames:', error);
  }
}

// ============================================================
// Batch Processing Functions (Memory Optimization)
// Added: 2026-02-06
// Purpose: Process frames in batches to reduce peak memory usage
// ============================================================

/**
 * Default batch size for frame extraction
 * Balances memory usage (~500MB per batch) with processing efficiency
 */
export const DEFAULT_BATCH_SIZE = 100;

/**
 * Reduced concurrency for batch processing to stay within memory limits
 * With batch size 100 and concurrency 4: ~400MB peak for frame extraction
 */
const BATCH_FRAME_EXTRACTION_CONCURRENCY = 4;

/**
 * Detect scenes without extracting frames
 * Used for batch processing where frames are extracted in batches
 * @param videoPath - Path to the video file
 * @param existingMetadata - Pre-fetched video metadata (optional)
 * @returns Object containing scenes (without screenshots) and video metadata
 */
export async function detectScenesOnly(
  videoPath: string,
  existingMetadata?: VideoMetadata,
  onProgress?: SceneDetectionProgressCallback,
): Promise<{ scenes: Scene[]; videoMetadata: VideoMetadata }> {
  console.log(`🎬 Starting scene detection (PySceneDetect, batch mode - no frame extraction)...`);

  // Use existing metadata if provided, otherwise fetch
  const videoMetadata = existingMetadata || await getVideoMetadata(videoPath);
  console.log(`  📹 Video duration: ${videoMetadata.duration}s`);

  // Always use PySceneDetect ContentDetector
  const { detectWithPyScene } = await import('./pysceneDetector.js');
  const pyResult = await detectWithPyScene(videoPath, videoMetadata.duration, onProgress);
  const cuts = pyResult.cuts;
  const telopAnimations = pyResult.telopAnimations;
  const panAnimations = pyResult.panAnimations;
  console.log(`  ✓ PySceneDetect: ${cuts.length} cuts detected`);

  if (cuts.length === 0) {
    console.warn('⚠️ No scene cuts detected, falling back to single scene');
    cuts.push({ timestamp: 0, confidence: 0.03 });
  }

  const scenes = await generateSceneRanges(cuts, videoMetadata.duration, 0.2, telopAnimations, panAnimations);

  console.log(`✅ Detected ${scenes.length} scenes (frames will be extracted in batches)`);

  return { scenes, videoMetadata };
}

/**
 * Extract frames for a batch of scenes
 * @param videoPath - Path to the video file
 * @param scenes - Batch of scenes to extract frames for
 * @param framesDir - Directory to store extracted frames
 * @param videoMetadata - Video metadata for adaptive resizing
 * @returns Updated scenes with screenshotPath set
 */
export async function extractFramesForBatch(
  videoPath: string,
  scenes: Scene[],
  framesDir: string,
  videoMetadata: VideoMetadata,
  targetWidth?: number
): Promise<Scene[]> {
  // Ensure directory exists
  await fs.mkdir(framesDir, { recursive: true });

  const blurAvoidanceEnabled = (process.env.BLUR_AVOIDANCE_ENABLED || 'true').toLowerCase() === 'true';
  const limit = pLimit(BATCH_FRAME_EXTRACTION_CONCURRENCY);
  const startTime = Date.now();

  // Count dissolve scenes for logging
  const widthInfo = targetWidth ? ` at ${targetWidth}px` : '';
  const blurInfo = blurAvoidanceEnabled ? `, blur avoidance: ON (all scenes)` : '';
  console.log(`  📸 Extracting ${scenes.length} frames${widthInfo} (batch, concurrency: ${BATCH_FRAME_EXTRACTION_CONCURRENCY}${blurInfo})...`);

  let blurRetryCount = 0;
  let dissolveDetectedCount = 0;

  // Dissolve detection thresholds (Phase A: logging only)
  const dissolveEdgeThreshold = parseFloat(
    process.env.DISSOLVE_EDGE_RATIO_THRESHOLD || String(DEFAULT_DISSOLVE_EDGE_RATIO_THRESHOLD)
  );
  const dissolveContrastThreshold = parseFloat(
    process.env.DISSOLVE_LOCAL_CONTRAST_THRESHOLD || String(DEFAULT_DISSOLVE_LOCAL_CONTRAST_THRESHOLD)
  );

  // Collect quality metrics for structured summary log
  const qualityMetrics: Array<{
    scene: number;
    sharpness: number;
    edgeRatio: number;
    localContrast: number;
    isDissolveCandidate: boolean;
    blurRetried: boolean;
  }> = [];

  await Promise.all(
    scenes.map((scene) =>
      limit(async () => {
        const filename = path.join(framesDir, `scene-${scene.sceneNumber.toString().padStart(4, '0')}.png`);

        await extractFrameAtTime(videoPath, scene.midTime, filename, videoMetadata, targetWidth);

        let blurRetried = false;

        if (blurAvoidanceEnabled) {
          // Apply blur avoidance to ALL scenes (not just dissolve-tagged ones)
          // Internal dissolves within a scene may not be tagged as dissolve_transition
          const sharpness = await measureFrameSharpness(filename);
          const threshold = parseFloat(process.env.BLUR_SHARPNESS_THRESHOLD || String(DEFAULT_SHARPNESS_THRESHOLD));
          if (sharpness < threshold) {
            console.log(`  🔍 Scene ${scene.sceneNumber}: blurry (sharpness=${sharpness.toFixed(1)}, threshold=${threshold}), trying alternatives...`);
            blurRetryCount++;
            blurRetried = true;
            // Try alternative positions within the scene
            const duration = scene.endTime - scene.startTime;
            let bestScore = sharpness;
            let bestPath = filename;
            const dir = path.dirname(filename);
            const ext = path.extname(filename);
            const base = path.basename(filename, ext);

            for (let ci = 0; ci < BLUR_RETRY_OFFSETS.length; ci++) {
              let t = scene.startTime + duration * BLUR_RETRY_OFFSETS[ci];
              // Skip candidates within dissolve zone if known
              if (scene.dissolveStart != null && scene.dissolveEnd != null) {
                if (t >= scene.dissolveStart && t <= scene.dissolveEnd) continue;
              }
              t = Math.max(scene.startTime + 0.1, Math.min(t, scene.endTime - 0.1));

              const candidatePath = path.join(dir, `${base}_cand${ci}${ext}`);
              try {
                await extractFrameAtTime(videoPath, t, candidatePath, videoMetadata, targetWidth);
                const score = await measureFrameSharpness(candidatePath);
                if (score > bestScore) {
                  if (bestPath !== filename) await fs.unlink(bestPath).catch(() => {});
                  bestScore = score;
                  bestPath = candidatePath;
                  if (score >= threshold) break;
                } else {
                  await fs.unlink(candidatePath).catch(() => {});
                }
              } catch {
                await fs.unlink(candidatePath).catch(() => {});
              }
            }

            if (bestPath !== filename) {
              await fs.unlink(filename).catch(() => {});
              await fs.rename(bestPath, filename);
              console.log(`  ✅ Scene ${scene.sceneNumber}: replaced with sharper frame (sharpness=${bestScore.toFixed(1)}, was ${sharpness.toFixed(1)})`);
            } else {
              console.log(`  ⚠️ Scene ${scene.sceneNumber}: no sharper alternative found (best=${bestScore.toFixed(1)}), keeping original`);
            }
          }

          // Measure full quality metrics on the final frame for dissolve detection
          const quality = await measureFrameQuality(filename);
          const isDissolveCandidate =
            quality.sharpness >= threshold &&
            quality.edgeRatio < dissolveEdgeThreshold &&
            quality.localContrast < dissolveContrastThreshold;

          if (isDissolveCandidate) {
            dissolveDetectedCount++;
          }

          qualityMetrics.push({
            scene: scene.sceneNumber,
            sharpness: quality.sharpness,
            edgeRatio: quality.edgeRatio,
            localContrast: quality.localContrast,
            isDissolveCandidate,
            blurRetried,
          });
        }

        // Set screenshot path
        scene.screenshotPath = filename;
      })
    )
  );

  const elapsed = Date.now() - startTime;

  // Structured summary log — always visible in Cloud Run logs
  // (individual per-scene logs may be buffered and hard to filter)
  const sortedMetrics = qualityMetrics.sort((a, b) => a.scene - b.scene);
  const dissolveCandidates = sortedMetrics.filter(m => m.isDissolveCandidate);
  const blurRetries = sortedMetrics.filter(m => m.blurRetried);

  // JSON structured log for Cloud Logging queryability
  console.log(JSON.stringify({
    severity: 'INFO',
    message: `FRAME_QUALITY_SUMMARY: ${scenes.length} frames, ${blurRetryCount} blur retries, ${dissolveDetectedCount} dissolve candidates`,
    frameQualitySummary: {
      totalFrames: scenes.length,
      blurRetries: blurRetryCount,
      dissolveCandidates: dissolveDetectedCount,
      elapsedMs: elapsed,
      thresholds: {
        sharpness: parseFloat(process.env.BLUR_SHARPNESS_THRESHOLD || String(DEFAULT_SHARPNESS_THRESHOLD)),
        dissolveEdgeRatio: dissolveEdgeThreshold,
        dissolveLocalContrast: dissolveContrastThreshold,
      },
      metrics: sortedMetrics.map(m => ({
        scene: m.scene,
        s: m.sharpness,
        e: m.edgeRatio,
        lc: m.localContrast,
        ...(m.isDissolveCandidate ? { dissolve: true } : {}),
        ...(m.blurRetried ? { blurRetried: true } : {}),
      })),
    },
  }));

  // Human-readable summary for gcloud run services logs read
  console.log(`  ⚡ Batch frame extraction: ${scenes.length} frames in ${(elapsed / 1000).toFixed(1)}s`
    + (blurRetryCount > 0 ? `, ${blurRetryCount} blur retries` : '')
    + (dissolveDetectedCount > 0 ? `, ${dissolveDetectedCount} dissolve-like frames` : ''));

  if (dissolveCandidates.length > 0) {
    console.log(`  🔬 Dissolve candidates: ${dissolveCandidates.map(m => `Scene ${m.scene} (edge=${m.edgeRatio.toFixed(4)}, lc=${m.localContrast.toFixed(1)})`).join(', ')}`);
  }

  // Per-scene metrics table (compact, single log entry)
  const metricsTable = sortedMetrics
    .map(m => `S${m.scene}:${m.sharpness.toFixed(0)}/${m.edgeRatio.toFixed(3)}/${m.localContrast.toFixed(0)}${m.isDissolveCandidate ? '⚠' : ''}${m.blurRetried ? '🔄' : ''}`)
    .join(' | ');
  console.log(`  📊 Quality [sharpness/edgeRatio/localContrast]: ${metricsTable}`);

  return scenes;
}

/**
 * Cleanup frames for a specific batch of scenes
 * Removes only the frame files for the given scenes, not the entire directory
 * @param scenes - Batch of scenes with screenshotPath to cleanup
 */
export async function cleanupBatchFrames(scenes: Scene[]): Promise<void> {
  let cleaned = 0;
  let failed = 0;

  await Promise.all(
    scenes.map(async (scene) => {
      if (scene.screenshotPath) {
        try {
          await fs.unlink(scene.screenshotPath);
          cleaned++;
        } catch (error) {
          // File might already be deleted or not exist
          failed++;
        }
        // Clear the path to free string memory
        scene.screenshotPath = undefined;
      }
    })
  );

  console.log(`  🧹 Batch cleanup: ${cleaned} frames deleted${failed > 0 ? `, ${failed} already gone` : ''}`);
}

/**
 * Get current memory usage for monitoring
 * @returns Memory usage info in MB
 */
export function getMemoryUsage(): { heapUsed: number; heapTotal: number; rss: number; external: number } {
  const usage = process.memoryUsage();
  return {
    heapUsed: Math.round(usage.heapUsed / 1024 / 1024),
    heapTotal: Math.round(usage.heapTotal / 1024 / 1024),
    rss: Math.round(usage.rss / 1024 / 1024),
    external: Math.round(usage.external / 1024 / 1024),
  };
}

/**
 * Log memory usage with label
 * @param label - Description of current operation
 */
export function logMemoryUsage(label: string): void {
  const mem = getMemoryUsage();
  console.log(`  💾 Memory [${label}]: Heap ${mem.heapUsed}/${mem.heapTotal}MB, RSS ${mem.rss}MB`);
}

// ============================================================
// Enhanced Mode V2 Functions (TransNet V2 Support)
// Added: 2026-01-17
// ============================================================

/**
 * Video chunk info for parallel processing
 */
export interface VideoChunk {
  index: number;
  path: string;
  startTime: number;  // Actual start time in original video (seconds)
  endTime: number;    // Actual end time in original video (seconds)
  duration: number;   // Chunk duration (seconds)
  offset: number;     // Offset for timestamp calculation (= startTime)
}

/**
 * Transcode video to 720p for processing efficiency
 * Used by TransNet V2 to reduce GPU/CPU load while maintaining detection accuracy
 *
 * @param inputPath - Path to original video file
 * @param outputPath - Path for transcoded output
 * @param targetHeight - Target height in pixels (default: 720)
 * @returns Path to transcoded video
 */
export async function transcodeToProcessingResolution(
  inputPath: string,
  outputPath: string,
  targetHeight: number = 720
): Promise<string> {
  console.log(`🎬 Transcoding to ${targetHeight}p for processing...`);

  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .outputOptions([
        `-vf scale=-2:${targetHeight}`, // Maintain aspect ratio, height=720
        '-c:v libx264',
        '-preset fast',
        '-crf 23',
        '-c:a copy', // Keep original audio
        '-y' // Overwrite if exists
      ])
      .output(outputPath)
      .on('start', (cmd) => {
        console.log(`  FFmpeg command: ${cmd.substring(0, 100)}...`);
      })
      .on('progress', (progress) => {
        if (progress.percent) {
          process.stdout.write(`\r  Progress: ${Math.round(progress.percent)}%`);
        }
      })
      .on('end', () => {
        console.log(`\n✅ Transcoded to ${targetHeight}p: ${outputPath}`);
        resolve(outputPath);
      })
      .on('error', (err) => {
        console.error(`❌ Transcode error: ${err.message}`);
        reject(new Error(`Transcode failed: ${err.message}`));
      })
      .run();
  });
}

/**
 * Split video into chunks with overlap for parallel processing
 * Each chunk has 10-second overlap with adjacent chunks to ensure
 * scene cuts at boundaries are detected
 *
 * @param inputPath - Path to video file
 * @param outputDir - Directory for chunk outputs
 * @param chunkDuration - Duration of each chunk in seconds (default: 60)
 * @param overlapDuration - Overlap duration in seconds (default: 10)
 * @returns Array of VideoChunk info with paths and offsets
 */
export async function splitVideoWithOverlap(
  inputPath: string,
  outputDir: string,
  chunkDuration: number = 60,
  overlapDuration: number = 10
): Promise<VideoChunk[]> {
  console.log(`✂️ Splitting video into ${chunkDuration}s chunks with ${overlapDuration}s overlap...`);

  // Get video duration
  const metadata = await getVideoMetadata(inputPath);
  const totalDuration = metadata.duration;

  console.log(`  Total duration: ${totalDuration.toFixed(1)}s`);

  // Create output directory
  await fs.mkdir(outputDir, { recursive: true });

  // Calculate chunk boundaries
  const chunks: VideoChunk[] = [];
  let chunkIndex = 0;
  let currentStart = 0;

  while (currentStart < totalDuration) {
    // Calculate chunk boundaries with overlap
    const chunkStart = Math.max(0, currentStart - (chunkIndex > 0 ? overlapDuration : 0));
    const chunkEnd = Math.min(totalDuration, currentStart + chunkDuration + overlapDuration);
    const actualDuration = chunkEnd - chunkStart;

    const chunkPath = path.join(outputDir, `chunk_${chunkIndex.toString().padStart(3, '0')}.mp4`);

    chunks.push({
      index: chunkIndex,
      path: chunkPath,
      startTime: chunkStart,
      endTime: chunkEnd,
      duration: actualDuration,
      offset: currentStart // Offset for timestamp calculation
    });

    currentStart += chunkDuration;
    chunkIndex++;
  }

  console.log(`  Calculated ${chunks.length} chunks`);

  // Split video into chunks
  for (const chunk of chunks) {
    await new Promise<void>((resolve, reject) => {
      ffmpeg(inputPath)
        .setStartTime(chunk.startTime)
        .setDuration(chunk.duration)
        .outputOptions([
          '-c:v copy',
          '-c:a copy',
          '-avoid_negative_ts make_zero',
          '-y'
        ])
        .output(chunk.path)
        .on('end', () => {
          console.log(`  ✓ Chunk ${chunk.index}: ${chunk.startTime.toFixed(1)}s - ${chunk.endTime.toFixed(1)}s`);
          resolve();
        })
        .on('error', (err) => {
          reject(new Error(`Failed to split chunk ${chunk.index}: ${err.message}`));
        })
        .run();
    });
  }

  console.log(`✅ Split into ${chunks.length} chunks`);
  return chunks;
}

/**
 * Merge timestamps from multiple chunks with offset calculation
 * Handles deduplication of overlapping regions
 *
 * @param chunkResults - Array of results from each chunk worker
 * @param overlapDuration - Overlap duration for deduplication (default: 10)
 * @returns Merged and deduplicated timestamps
 */
export function mergeChunkTimestamps(
  chunkResults: Array<{ chunk: VideoChunk; timestamps: number[] }>,
  overlapDuration: number = 10
): number[] {
  console.log(`🔀 Merging timestamps from ${chunkResults.length} chunks...`);

  // Apply offset to each timestamp
  const allTimestamps: number[] = [];

  for (const { chunk, timestamps } of chunkResults) {
    for (const ts of timestamps) {
      // Convert chunk-local timestamp to global timestamp
      const globalTs = chunk.startTime + ts;

      // Skip timestamps in the leading overlap region (except for chunk 0)
      if (chunk.index > 0 && ts < overlapDuration) {
        continue; // This timestamp is in the overlap region, skip it
      }

      allTimestamps.push(globalTs);
    }
  }

  // Sort timestamps
  allTimestamps.sort((a, b) => a - b);

  // Deduplicate timestamps within overlap threshold
  const deduplicationThreshold = 0.5; // 500ms
  const deduplicated: number[] = [];

  for (const ts of allTimestamps) {
    const isDuplicate = deduplicated.some(
      existing => Math.abs(existing - ts) < deduplicationThreshold
    );

    if (!isDuplicate) {
      deduplicated.push(ts);
    }
  }

  console.log(`  Raw: ${allTimestamps.length} timestamps → Deduplicated: ${deduplicated.length}`);
  return deduplicated;
}

/**
 * Clean up chunk files
 * @param chunks - Array of VideoChunk to clean up
 */
export async function cleanupChunks(chunks: VideoChunk[]): Promise<void> {
  if (chunks.length === 0) return;

  const outputDir = path.dirname(chunks[0].path);

  try {
    await fs.rm(outputDir, { recursive: true, force: true });
    console.log(`🧹 Cleaned up chunk files: ${outputDir}`);
  } catch (error) {
    console.error('⚠️ Error cleaning up chunks:', error);
  }
}
