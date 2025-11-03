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
async function safeUpdateStatus(uploadId, updates) {
    try {
        await updateStatus(uploadId, updates);
    }
    catch (error) {
        console.warn(`[${uploadId}] Failed to update status (non-fatal in dev):`, error);
        if (process.env.NODE_ENV === 'production') {
            throw error;
        }
    }
}
export const processVideo = async (uploadId, blobUrl, fileName, dataConsent) => {
    try {
        console.log(`[${uploadId}] Starting video processing`);
        // Try to initialize status in Supabase (optional in dev mode)
        try {
            await initStatus(uploadId);
        }
        catch (statusError) {
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
            let transcription = [];
            let vadStats = null;
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
            }
            else {
                console.log(`[${uploadId}] ⚠️ No audio stream detected, skipping transcription`);
                await safeUpdateStatus(uploadId, { status: 'processing', progress: 45, stage: 'audio_skipped' });
            }
            // Step 5: Execute ideal Excel pipeline (Scene detection + OCR + Excel generation)
            console.log(`[${uploadId}] Executing ideal Excel pipeline (Scene-based OCR + Excel)...`);
            await safeUpdateStatus(uploadId, { status: 'processing', progress: 60, stage: 'scene_ocr_excel' });
            const pipelineResult = await executeIdealPipeline(videoPath, fileName, transcription);
            const excelPath = pipelineResult.excelPath;
            // Step 9: Upload result file or store locally for development
            console.log(`[${uploadId}] Uploading results...`);
            await safeUpdateStatus(uploadId, { status: 'processing', progress: 90, stage: 'upload_result' });
            let resultUrl;
            let resultBlobUrl = null;
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
            }
            else {
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
            const completionMetadata = {
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
            }
            catch (statusError) {
                console.error(`[${uploadId}] Failed to update Supabase status (non-fatal in dev):`, statusError);
                if (process.env.NODE_ENV === 'production') {
                    throw statusError; // Re-throw in production
                }
                // In development, continue - file is already saved locally
                console.log(`[${uploadId}] Continuing despite status update failure (dev mode)`);
            }
        }
        finally {
            // Cleanup
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    }
    catch (error) {
        console.error(`[${uploadId}] Processing failed:`, error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
        await failStatus(uploadId, errorMessage);
    }
};
async function downloadFile(url, dest) {
    const response = await axios.get(url, {
        responseType: 'stream',
        timeout: 60000
    });
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);
        response.data.pipe(file);
        file.on('finish', () => {
            file.close();
            resolve(null);
        });
        file.on('error', reject);
    });
}
//# sourceMappingURL=videoProcessor.js.map