import axios from 'axios';
import { initStatus, updateStatus, completeStatus, failStatus } from './statusManager.js';
import { executeIdealPipeline } from './pipeline.js';
import { getVideoMetadata } from './ffmpeg.js';
import { uploadResultFile } from './blobUploader.js';
import { extractAudioForWhisper, hasAudioStream } from './audioExtractor.js';
import { processAudioWithVADAndWhisper } from './audioWhisperPipeline.js';
import { deleteBlob } from './blobCleaner.js';
import { resultFileMap } from '../index.js';
import path from 'path';
import fs from 'fs';
import os from 'os';

/**
 * Safe status update wrapper - non-fatal in development mode
 */
async function safeUpdateStatus(uploadId: string, updates: any): Promise<void> {
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
  try {
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

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'video-analyzer-'));
    const videoPath = path.join(tempDir, 'video.mp4');

    try {
      // Step 1: Download video
      console.log(`[${uploadId}] Downloading video from blob...`);
      await safeUpdateStatus(uploadId, { status: 'downloading', progress: 10, stage: 'downloading' });

      await downloadFile(blobUrl, videoPath);

      // Delete source video blob after successful download
      console.log(`[${uploadId}] Deleting source video blob...`);
      await deleteBlob(blobUrl);

      // Step 2: Extract video metadata
      console.log(`[${uploadId}] Extracting video metadata...`);
      await safeUpdateStatus(uploadId, { status: 'processing', progress: 20, stage: 'metadata' });

      const videoMetadata = await getVideoMetadata(videoPath);

      // Step 3: Extract audio (Whisper-optimized)
      console.log(`[${uploadId}] Checking for audio stream...`);
      await safeUpdateStatus(uploadId, { status: 'processing', progress: 30, stage: 'audio' });

      const audioPath = path.join(tempDir, 'audio.mp3');
      const hasAudio = await hasAudioStream(videoPath);

      let transcription: any[] = [];
      let vadStats: any = null;

      if (hasAudio) {
        console.log(`[${uploadId}] Extracting audio (16kHz mono, noise reduction)...`);
        await extractAudioForWhisper(videoPath, audioPath);

        // Step 4: VAD + Whisper pipeline (optimized processing)
        console.log(`[${uploadId}] Processing with VAD + Whisper pipeline...`);
        await safeUpdateStatus(uploadId, { status: 'processing', progress: 45, stage: 'vad_whisper' });

        const pipelineResult = await processAudioWithVADAndWhisper(audioPath, uploadId);
        transcription = pipelineResult.segments;
        vadStats = pipelineResult.vadStats;

        console.log(`[${uploadId}] VAD + Whisper complete: ${transcription.length} segments`);
        console.log(`[${uploadId}]   Voice ratio: ${(vadStats.voiceRatio * 100).toFixed(1)}%`);
        console.log(`[${uploadId}]   Cost savings: ${vadStats.estimatedSavings.toFixed(1)}%`);
      } else {
        console.log(`[${uploadId}] ⚠️ No audio stream detected, skipping transcription`);
        await safeUpdateStatus(uploadId, { status: 'processing', progress: 45, stage: 'audio_skipped' });
      }

      // Step 5: Execute ideal Excel pipeline (Scene detection + OCR + Excel generation)
      console.log(`[${uploadId}] Executing ideal Excel pipeline (Scene-based OCR + Excel)...`);
      await safeUpdateStatus(uploadId, { status: 'processing', progress: 60, stage: 'scene_ocr_excel' });

      const pipelineResult = await executeIdealPipeline(
        videoPath,
        fileName,
        transcription
      );

      const excelPath = pipelineResult.excelPath;

      // Step 9: Upload result file or store locally for development
      console.log(`[${uploadId}] Uploading results...`);
      await safeUpdateStatus(uploadId, { status: 'processing', progress: 90, stage: 'upload_result' });

      let resultUrl: string;
      let resultBlobUrl: string | null = null;

      if (process.env.NODE_ENV === 'development') {
        // Development mode: Store file path locally
        const persistentPath = path.join('/tmp', `result_${uploadId}.xlsx`);
        fs.copyFileSync(excelPath, persistentPath);
        resultFileMap.set(uploadId, persistentPath);

        // Return uploadId only - frontend will construct /api/download/${uploadId}
        // This ensures consistent authentication flow
        resultUrl = uploadId;

        console.log(`[${uploadId}] Development mode: File stored at ${persistentPath}`);
        console.log(`[${uploadId}] Result URL (uploadId): ${resultUrl}`);
      } else {
        // Production mode: Upload to Vercel Blob
        resultBlobUrl = await uploadResultFile(excelPath, uploadId);

        // Return uploadId to maintain consistent authentication flow
        // resultBlobUrl will be stored in metadata for /api/download to retrieve
        resultUrl = uploadId;

        console.log(`[${uploadId}] Production mode: Uploaded to Blob`);
        console.log(`[${uploadId}] Blob URL: ${resultBlobUrl}`);
        console.log(`[${uploadId}] Result URL (uploadId): ${resultUrl}`);
      }

      // Complete with metadata (including resultBlobUrl for production downloads)
      console.log(`[${uploadId}] Processing completed!`);

      const completionMetadata: any = {
        duration: videoMetadata.duration,
        segmentCount: transcription.length,
        ocrResultCount: pipelineResult.stats.scenesWithOCRText,
        transcriptionLength: transcription.reduce((sum, seg) => sum + seg.text.length, 0),
        totalScenes: pipelineResult.stats.totalScenes,
        scenesWithOCR: pipelineResult.stats.scenesWithOCRText,
        scenesWithNarration: pipelineResult.stats.scenesWithNarration,
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

    } finally {
      // Cleanup
      fs.rmSync(tempDir, { recursive: true, force: true });
    }

  } catch (error) {
    console.error(`[${uploadId}] Processing failed:`, error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    await failStatus(uploadId, errorMessage);
  }
};

async function downloadFile(url: string, dest: string) {
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
    let lastLoggedBytes = 0; // Track last logged position for progress reporting
    const totalBytes = parseInt(response.headers['content-length'] || '0');
    const LOG_INTERVAL = 10 * 1024 * 1024; // 10MB

    response.data.on('data', (chunk: Buffer) => {
      downloadedBytes += chunk.length;

      // Log progress when 10MB or more has been downloaded since last log
      if (totalBytes > 0 && downloadedBytes - lastLoggedBytes >= LOG_INTERVAL) {
        const percent = ((downloadedBytes / totalBytes) * 100).toFixed(1);
        console.log(`[downloadFile] Progress: ${percent}% (${(downloadedBytes / 1024 / 1024).toFixed(1)}MB / ${(totalBytes / 1024 / 1024).toFixed(1)}MB)`);
        lastLoggedBytes = downloadedBytes;
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

