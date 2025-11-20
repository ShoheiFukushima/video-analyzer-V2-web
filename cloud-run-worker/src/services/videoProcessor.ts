import axios from 'axios';
import { initStatus, updateStatus, completeStatus, failStatus, ProcessingStatus } from './statusManager.js';
import { executeIdealPipeline } from './pipeline.js';
import { getVideoMetadata } from './ffmpeg.js';
import { uploadResultFile } from './blobUploader.js';
import { extractAudioForWhisper, hasAudioStream, preprocessAudioForVAD } from './audioExtractor.js';
import { processAudioWithVADAndWhisper } from './audioWhisperPipeline.js';
import { deleteBlob } from './blobCleaner.js';
import { logCriticalError } from './errorTracking.js';
import { resultFileMap } from '../index.js';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type {
  TranscriptionSegment,
  VADStats,
  CompressionResult,
  ProcessingMetadata
} from '../types/shared.js';

const execFileAsync = promisify(execFile);

/**
 * Progress range for download operations
 * Maps download progress (0-100%) to overall progress percentage
 */
interface ProgressRange {
  start: number; // Starting progress percentage (e.g., 10)
  end: number;   // Ending progress percentage (e.g., 20)
}

/**
 * Utility function to measure and log execution time of async operations
 * @param uploadId - Upload ID for logging
 * @param stepName - Name of the step being timed
 * @param fn - Async function to execute
 * @returns Result of the async function
 */
async function timeStep<T>(uploadId: string, stepName: string, fn: () => Promise<T>): Promise<T> {
  const startTime = Date.now();
  console.log(`[${uploadId}] ⏱️  [${stepName}] Starting...`);

  try {
    const result = await fn();
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`[${uploadId}] ✅ [${stepName}] Completed in ${duration}s`);
    return result;
  } catch (error) {
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.error(`[${uploadId}] ❌ [${stepName}] Failed after ${duration}s`);
    throw error;
  }
}

/**
 * Safe status update wrapper - non-fatal in development mode
 */
async function safeUpdateStatus(uploadId: string, updates: Partial<ProcessingStatus>): Promise<void> {
  try {
    await updateStatus(uploadId, updates);
  } catch (error) {
    console.warn(`[${uploadId}] Failed to update status (non-fatal in dev):`, error);
    if (process.env.NODE_ENV === 'production') {
      throw error;
    }
  }
}

export const processVideo = async (
  uploadId: string,
  blobUrl: string,
  fileName: string,
  userId: string, // Security: User ID for IDOR protection
  dataConsent: boolean
) => {
  const overallStartTime = Date.now();
  let blobDeleted = false; // Track if blob has been deleted
  let tempDir: string | null = null;

  try {
    console.log(`[${uploadId}] ═══════════════════════════════════════════════`);
    console.log(`[${uploadId}] Starting video processing for user ${userId}`);

    // Security: Initialize status with userId for access control
    try {
      await initStatus(uploadId, userId);
    } catch (statusError) {
      console.warn(`[${uploadId}] Failed to initialize Supabase status (continuing):`, statusError);
      if (process.env.NODE_ENV === 'production') {
        throw statusError;
      }
    }

    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'video-analyzer-'));
    const videoPath = path.join(tempDir, 'video.mp4');
    const audioPath = path.join(tempDir, 'audio.mp3');

    try {
      // Ref object to track blob deletion status (passed by reference to helper function)
      const blobDeletedRef = { value: false };

      // Step 1: Download video, delete source blob, and compress if needed
      await downloadAndPrepareVideo(uploadId, blobUrl, videoPath, blobDeletedRef);
      blobDeleted = blobDeletedRef.value;

      // Step 2-3: Extract metadata and audio
      const { videoMetadata, hasAudio } = await extractMetadataAndAudio(uploadId, videoPath, audioPath);

      // Step 4: Perform VAD + Whisper transcription (if audio exists)
      const { transcription, vadStats } = await performTranscription(uploadId, audioPath, hasAudio);

      // Step 5: Execute scene detection, OCR, and Excel generation
      const { excelPath, stats } = await executeSceneDetectionAndOCR(
        uploadId,
        videoPath,
        fileName,
        transcription
      );

      // Step 6: Upload result and complete processing
      await uploadResultAndComplete(
        uploadId,
        excelPath,
        videoMetadata,
        transcription,
        stats,
        overallStartTime
      );

    } finally {
      // Cleanup temporary directory
      if (tempDir) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    }

  } catch (error) {
    console.error(`[${uploadId}] Processing failed:`, error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    await failStatus(uploadId, errorMessage);
  } finally {
    // CRITICAL: Always delete the source blob, even on error
    // This prevents storage quota exhaustion
    if (!blobDeleted) {
      console.log(`[${uploadId}] Attempting final blob cleanup...`);
      try {
        await deleteBlob(blobUrl);
        console.log(`[${uploadId}] ✅ Blob deleted in final cleanup`);
      } catch (deleteError) {
        // Ignore 404 errors (blob already deleted)
        const errorMessage = deleteError instanceof Error ? deleteError.message : String(deleteError);
        if (errorMessage.includes('404') || errorMessage.includes('not found')) {
          console.log(`[${uploadId}] ℹ️  Blob already deleted (404), skipping`);
        } else {
          console.error(`[${uploadId}] ❌ CRITICAL: Failed to delete blob in final cleanup:`, deleteError);

          // Log to error tracking service (Cloud Monitoring)
          logCriticalError(deleteError instanceof Error ? deleteError : new Error(String(deleteError)), {
            uploadId,
            blobUrl,
            operation: 'blob_cleanup',
            stage: 'final_cleanup',
          });
        }
      }
    }
  }
};

/**
 * Download video, delete source blob, and compress if needed
 *
 * @param uploadId - Upload ID for logging
 * @param blobUrl - Source video Blob URL
 * @param videoPath - Destination path for video
 * @param blobDeleted - Ref object to track blob deletion status
 * @returns void
 */
async function downloadAndPrepareVideo(
  uploadId: string,
  blobUrl: string,
  videoPath: string,
  blobDeleted: { value: boolean }
): Promise<void> {
  // Step 1: Download video
  await safeUpdateStatus(uploadId, { status: 'downloading', progress: 10, stage: 'downloading' });

  await timeStep(uploadId, 'Download Video', async () => {
    await downloadFile(blobUrl, videoPath, uploadId, { start: 10, end: 20 });
  });

  // Delete source video blob after successful download (early cleanup)
  try {
    await timeStep(uploadId, 'Delete Source Blob', async () => {
      await deleteBlob(blobUrl);
      blobDeleted.value = true;
    });
  } catch (deleteError) {
    console.warn(`[${uploadId}] ⚠️  Failed to delete blob (will retry in finally):`, deleteError);
  }

  // Step 1.5: Compress video if needed
  await safeUpdateStatus(uploadId, {
    status: 'processing',
    progress: 15,
    stage: 'compressing'
  });

  try {
    const compressionResult = await timeStep(uploadId, 'Compress Video (if needed)', async () => {
      return await compressVideoIfNeeded(videoPath, uploadId);
    });
    if (compressionResult.compressed) {
      const originalMB = (compressionResult.originalSize / 1024 / 1024).toFixed(1);
      const newMB = (compressionResult.newSize / 1024 / 1024).toFixed(1);
      const reductionPercent = (((compressionResult.originalSize - compressionResult.newSize) / compressionResult.originalSize) * 100).toFixed(1);
      console.log(`[${uploadId}] ✅ Compressed: ${originalMB}MB → ${newMB}MB (${reductionPercent}% reduction)`);
    } else {
      const sizeMB = (compressionResult.originalSize / 1024 / 1024).toFixed(1);
      console.log(`[${uploadId}] ℹ️  Compression skipped: ${sizeMB}MB (under 200MB threshold)`);
    }
  } catch (compressionError) {
    console.warn(`[${uploadId}] ⚠️  Compression failed, continuing with original file:`, compressionError);
    // Continue processing with original file (compression failure is not fatal)
  }
}

/**
 * Extract video metadata and audio (if available)
 *
 * @param uploadId - Upload ID for logging
 * @param videoPath - Path to video file
 * @param audioPath - Destination path for audio
 * @returns Object containing video metadata and hasAudio flag
 */
async function extractMetadataAndAudio(
  uploadId: string,
  videoPath: string,
  audioPath: string
): Promise<{ videoMetadata: any; hasAudio: boolean }> {
  // Step 2: Extract video metadata
  await safeUpdateStatus(uploadId, { status: 'processing', progress: 20, stage: 'metadata' });

  const videoMetadata = await timeStep(uploadId, 'Extract Video Metadata', async () => {
    return await getVideoMetadata(videoPath);
  });

  // Step 3: Extract audio (Whisper-optimized)
  await safeUpdateStatus(uploadId, { status: 'processing', progress: 30, stage: 'audio' });

  const hasAudio = await timeStep(uploadId, 'Detect Audio Stream', async () => {
    return await hasAudioStream(videoPath);
  });

  if (hasAudio) {
    await timeStep(uploadId, 'Extract Audio (16kHz mono)', async () => {
      await extractAudioForWhisper(videoPath, audioPath);
    });

    // Audio preprocessing for improved VAD detection (BGM suppression + voice enhancement)
    // Re-enabled after baseline test completion (2025-11-12)
    await timeStep(uploadId, 'Preprocess Audio (BGM suppression)', async () => {
      try {
        await preprocessAudioForVAD(audioPath, uploadId);
        console.log(`[${uploadId}] ✓ Audio preprocessing successful - VAD detection should improve`);
      } catch (preprocessError) {
        // Non-fatal error: Continue with original audio (fallback)
        console.warn(`[${uploadId}] ⚠️ Audio preprocessing failed, using original audio:`, preprocessError);
        console.warn(`[${uploadId}]    VAD detection may be less accurate without preprocessing`);
        // Do not throw - processing continues with original audio
      }
    });
  } else {
    console.log(`[${uploadId}] ⚠️ No audio stream detected, skipping audio extraction`);
  }

  return { videoMetadata, hasAudio };
}

/**
 * Perform VAD + Whisper transcription (if audio exists)
 *
 * @param uploadId - Upload ID for logging
 * @param audioPath - Path to audio file
 * @param hasAudio - Whether audio stream exists
 * @returns Object containing transcription segments and VAD statistics
 */
async function performTranscription(
  uploadId: string,
  audioPath: string,
  hasAudio: boolean
): Promise<{ transcription: TranscriptionSegment[]; vadStats: VADStats | null }> {
  let transcription: TranscriptionSegment[] = [];
  let vadStats: VADStats | null = null;

  if (hasAudio) {
    // Step 4: VAD + Whisper pipeline (optimized processing)
    await safeUpdateStatus(uploadId, { status: 'processing', progress: 45, stage: 'vad_whisper' });

    const pipelineResult = await timeStep(uploadId, 'VAD + Whisper Pipeline', async () => {
      return await processAudioWithVADAndWhisper(audioPath, uploadId);
    });
    transcription = pipelineResult.segments;
    vadStats = pipelineResult.vadStats;

    console.log(`[${uploadId}] VAD + Whisper complete: ${transcription.length} segments`);
    console.log(`[${uploadId}]   Voice ratio: ${(vadStats.voiceRatio * 100).toFixed(1)}%`);
    console.log(`[${uploadId}]   Cost savings: ${vadStats.estimatedSavings.toFixed(1)}%`);
  } else {
    console.log(`[${uploadId}] ⚠️ No audio stream detected, skipping transcription`);
    await safeUpdateStatus(uploadId, { status: 'processing', progress: 45, stage: 'audio_skipped' });
  }

  return { transcription, vadStats };
}

/**
 * Execute scene detection, OCR, and Excel generation pipeline
 *
 * @param uploadId - Upload ID for logging
 * @param videoPath - Path to video file
 * @param fileName - Original file name
 * @param transcription - Transcription segments
 * @returns Object containing Excel path and pipeline statistics
 */
async function executeSceneDetectionAndOCR(
  uploadId: string,
  videoPath: string,
  fileName: string,
  transcription: TranscriptionSegment[]
): Promise<{ excelPath: string; stats: any }> {
  // Step 5: Execute ideal Excel pipeline (Scene detection + OCR + Excel generation)
  await safeUpdateStatus(uploadId, { status: 'processing', progress: 60, stage: 'scene_ocr_excel' });

  const pipelineResult = await timeStep(uploadId, 'Scene Detection + OCR + Excel Generation', async () => {
    return await executeIdealPipeline(
      videoPath,
      fileName,
      transcription,
      uploadId
    );
  });

  return {
    excelPath: pipelineResult.excelPath,
    stats: pipelineResult.stats
  };
}

/**
 * Upload result file and complete processing status
 *
 * @param uploadId - Upload ID for logging
 * @param excelPath - Path to Excel file
 * @param videoMetadata - Video metadata
 * @param transcription - Transcription segments
 * @param stats - Pipeline statistics
 * @param overallStartTime - Overall processing start time
 * @returns Result URL and Blob URL (if in production)
 */
async function uploadResultAndComplete(
  uploadId: string,
  excelPath: string,
  videoMetadata: any,
  transcription: TranscriptionSegment[],
  stats: any,
  overallStartTime: number
): Promise<{ resultUrl: string; resultBlobUrl: string | null }> {
  // Step 9: Upload result file or store locally for development
  await safeUpdateStatus(uploadId, { status: 'processing', progress: 90, stage: 'upload_result' });

  let resultUrl: string = uploadId; // Initialize with uploadId
  let resultBlobUrl: string | null = null;

  await timeStep(uploadId, 'Upload Result File', async () => {
    if (process.env.NODE_ENV === 'development') {
      // Development mode: Store file path locally
      const persistentPath = path.join('/tmp', `result_${uploadId}.xlsx`);
      fs.copyFileSync(excelPath, persistentPath);
      resultFileMap.set(uploadId, persistentPath);

      console.log(`[${uploadId}] Development mode: File stored at ${persistentPath}`);
      console.log(`[${uploadId}] Result URL (uploadId): ${resultUrl}`);
    } else {
      // Production mode: Upload to Vercel Blob
      resultBlobUrl = await uploadResultFile(excelPath, uploadId);

      console.log(`[${uploadId}] Production mode: Uploaded to Blob`);
      console.log(`[${uploadId}] Blob URL: ${resultBlobUrl}`);
      console.log(`[${uploadId}] Result URL (uploadId): ${resultUrl}`);
    }
  });

  // Complete with metadata (including resultBlobUrl for production downloads)
  console.log(`[${uploadId}] Processing completed!`);

  const completionMetadata: ProcessingMetadata = {
    duration: videoMetadata.duration,
    segmentCount: transcription.length,
    ocrResultCount: stats.scenesWithOCRText,
    transcriptionLength: transcription.reduce((sum, seg) => sum + seg.text.length, 0),
    totalScenes: stats.totalScenes,
    scenesWithOCR: stats.scenesWithOCRText,
    scenesWithNarration: stats.scenesWithNarration,
  };

  // Store resultBlobUrl in metadata for production downloads
  if (resultBlobUrl) {
    completionMetadata.blobUrl = resultBlobUrl;
  }

  // Try to update Supabase status, but don't fail if it errors (dev mode resilience)
  try {
    await completeStatus(uploadId, resultUrl, completionMetadata);
  } catch (statusError) {
    console.error(`[${uploadId}] Failed to update Supabase status (non-fatal in dev):`, statusError);
    if (process.env.NODE_ENV === 'production') {
      throw statusError; // Re-throw in production
    }
    // In development, continue - file is already saved locally
    console.log(`[${uploadId}] Continuing despite status update failure (dev mode)`);
  }

  // Log overall processing time
  const overallDuration = ((Date.now() - overallStartTime) / 1000).toFixed(2);
  console.log(`[${uploadId}] ═══════════════════════════════════════════════`);
  console.log(`[${uploadId}] 🎉 TOTAL PROCESSING TIME: ${overallDuration}s`);
  console.log(`[${uploadId}] ═══════════════════════════════════════════════`);

  return { resultUrl, resultBlobUrl };
}

/**
 * Compress video if file size exceeds 200MB
 * Uses ffmpeg with CRF 28 and fast preset for optimal compression
 *
 * @param inputPath - Path to the input video file
 * @param uploadId - Upload ID for logging
 * @returns Object containing compression status and file sizes
 */
async function compressVideoIfNeeded(
  inputPath: string,
  uploadId: string
): Promise<CompressionResult> {
  const COMPRESSION_THRESHOLD = 200 * 1024 * 1024; // 200MB in bytes

  // Check file size
  const stats = fs.statSync(inputPath);
  const originalSize = stats.size;

  if (originalSize < COMPRESSION_THRESHOLD) {
    console.log(`[${uploadId}] File size ${(originalSize / 1024 / 1024).toFixed(1)}MB is under ${COMPRESSION_THRESHOLD / 1024 / 1024}MB threshold, skipping compression`);
    return { compressed: false, originalSize, newSize: originalSize };
  }

  console.log(`[${uploadId}] File size ${(originalSize / 1024 / 1024).toFixed(1)}MB exceeds threshold, starting compression...`);

  // Create temporary output path
  const outputPath = inputPath.replace('.mp4', '_compressed.mp4');

  try {
    const startTime = Date.now();

    // Execute ffmpeg compression
    // -vcodec libx264: H.264 video codec (widely compatible)
    // -crf 28: Constant Rate Factor (quality), 28 = good balance of quality/size
    // -preset fast: Encoding speed preset (faster encoding, slightly larger file)
    // -acodec aac: AAC audio codec (widely compatible)
    // -b:a 96k: Audio bitrate 96kbps (sufficient for speech)
    // -movflags +faststart: Optimize for web streaming
    // -y: Overwrite output file without asking
    const ffmpegArgs = [
      '-i', inputPath,
      '-vcodec', 'libx264',
      '-crf', '28',
      '-preset', 'fast',
      '-acodec', 'aac',
      '-b:a', '96k',
      '-movflags', '+faststart',
      '-y',
      outputPath
    ];

    console.log(`[${uploadId}] Running ffmpeg compression (CRF 28, fast preset)...`);

    const { stdout, stderr } = await execFileAsync('ffmpeg', ffmpegArgs, {
      maxBuffer: 10 * 1024 * 1024 // 10MB buffer for ffmpeg output
    });

    const endTime = Date.now();
    const durationSec = ((endTime - startTime) / 1000).toFixed(1);

    // Check output file
    if (!fs.existsSync(outputPath)) {
      throw new Error('Compression completed but output file not found');
    }

    const compressedStats = fs.statSync(outputPath);
    const newSize = compressedStats.size;

    console.log(`[${uploadId}] Compression completed in ${durationSec}s`);

    // Replace original file with compressed version
    fs.unlinkSync(inputPath);
    fs.renameSync(outputPath, inputPath);

    console.log(`[${uploadId}] Replaced original file with compressed version`);

    return { compressed: true, originalSize, newSize };

  } catch (error) {
    // Clean up temporary file if it exists
    if (fs.existsSync(outputPath)) {
      fs.unlinkSync(outputPath);
    }

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[${uploadId}] Compression failed: ${errorMessage}`);
    throw error;
  }
}

/**
 * Download file from URL with progress tracking
 * @param url - URL to download from
 * @param dest - Destination file path
 * @param uploadId - Upload ID for progress updates (optional)
 * @param progressRange - Progress range to map download progress to (default: 10-20%)
 */
async function downloadFile(
  url: string,
  dest: string,
  uploadId?: string,
  progressRange: ProgressRange = { start: 10, end: 20 }
) {
  console.log(`[downloadFile] Starting download from: ${url.substring(0, 100)}...`);

  const response = await axios.get(url, {
    responseType: 'stream',
    timeout: 300000, // 5 minutes timeout (increased from 60s for large videos)
    maxContentLength: 500 * 1024 * 1024, // 500MB max
    maxBodyLength: 500 * 1024 * 1024
  }).catch(err => {
    console.error(`[downloadFile] Axios request failed:`, {
      message: err.message,
      code: err.code,
      timeout: err.timeout,
      url: url.substring(0, 100)
    });
    throw new Error(`Failed to download video: ${err.message}`);
  });

  console.log(`[downloadFile] Response received, content-length: ${response.headers['content-length'] || 'unknown'}`);

  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    let downloadedBytes = 0;
    let lastLoggedBytes = 0; // Track last logged position for console logging
    const totalBytes = parseInt(response.headers['content-length'] || '0');
    const LOG_INTERVAL = 10 * 1024 * 1024; // 10MB for console logging

    // Progress update tracking (for Supabase updates)
    const PROGRESS_UPDATE_THRESHOLD = 0.02; // Update every 2% of download progress
    let lastProgressUpdate = 0;

    response.data.on('data', (chunk: Buffer) => {
      downloadedBytes += chunk.length;

      // Console logging (10MB intervals)
      if (totalBytes > 0 && downloadedBytes - lastLoggedBytes >= LOG_INTERVAL) {
        const percent = ((downloadedBytes / totalBytes) * 100).toFixed(1);
        console.log(`[downloadFile] Progress: ${percent}% (${(downloadedBytes / 1024 / 1024).toFixed(1)}MB / ${(totalBytes / 1024 / 1024).toFixed(1)}MB)`);
        lastLoggedBytes = downloadedBytes;
      }

      // Supabase progress updates (2% intervals)
      if (uploadId && totalBytes > 0) {
        const downloadProgress = downloadedBytes / totalBytes; // 0.0 - 1.0

        // Update if progress changed by 2%
        if (downloadProgress - lastProgressUpdate >= PROGRESS_UPDATE_THRESHOLD) {
          const range = progressRange.end - progressRange.start;
          const overallProgress = progressRange.start + (downloadProgress * range);

          // Fire-and-forget (non-blocking) Supabase update
          safeUpdateStatus(uploadId, {
            progress: Math.floor(overallProgress),
            stage: 'downloading'
          }).catch((err) => {
            // Non-fatal error - download continues even if Supabase update fails
            console.error(`[${uploadId}] Progress update failed (non-fatal):`, err);
          });

          lastProgressUpdate = downloadProgress;
        }
      }
    });

    response.data.pipe(file);

    file.on('finish', () => {
      file.close();
      console.log(`[downloadFile] Download complete: ${(downloadedBytes / 1024 / 1024).toFixed(1)}MB`);
      resolve(null);
    });

    file.on('error', (err) => {
      console.error(`[downloadFile] File write error:`, err);
      fs.unlink(dest, () => {}); // Clean up partial file
      reject(new Error(`Failed to write file: ${err.message}`));
    });

    response.data.on('error', (err: Error) => {
      console.error(`[downloadFile] Stream error:`, err);
      file.close();
      fs.unlink(dest, () => {}); // Clean up partial file
      reject(new Error(`Download stream error: ${err.message}`));
    });
  });
}

