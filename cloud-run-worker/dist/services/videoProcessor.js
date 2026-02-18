import { initStatus, updateStatus, completeStatus, failStatus, updatePhaseProgress, completePhase, skipPhase } from './statusManager.js';
import { executeIdealPipeline } from './pipeline.js';
import { getVideoMetadata, detectScenesOnly } from './ffmpeg.js';
import { uploadResultFile } from './blobUploader.js';
import { extractAudioForWhisper, hasAudioStream, preprocessAudioForVAD } from './audioExtractor.js';
import { processAudioWithVADAndWhisper } from './audioWhisperPipeline.js';
import { downloadFromR2Parallel, deleteFromR2 } from './r2Client.js';
import { logCriticalError } from './errorTracking.js';
import { resultFileMap, setCurrentProcessingUpload } from '../index.js';
import { getOrCreateCheckpoint, saveCheckpoint, deleteCheckpoint, } from './checkpointService.js';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
const execFileAsync = promisify(execFile);
/**
 * Utility function to measure and log execution time of async operations
 * @param uploadId - Upload ID for logging
 * @param stepName - Name of the step being timed
 * @param fn - Async function to execute
 * @returns Result of the async function
 */
async function timeStep(uploadId, stepName, fn) {
    const startTime = Date.now();
    console.log(`[${uploadId}] ⏱️  [${stepName}] Starting...`);
    try {
        const result = await fn();
        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log(`[${uploadId}] ✅ [${stepName}] Completed in ${duration}s`);
        return result;
    }
    catch (error) {
        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        console.error(`[${uploadId}] ❌ [${stepName}] Failed after ${duration}s`);
        throw error;
    }
}
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
export const processVideo = async (uploadId, r2Key, fileName, userId, // Security: User ID for IDOR protection
dataConsent, detectionMode = 'standard' // Enhanced mode for fade/dissolve detection
) => {
    const overallStartTime = Date.now();
    let r2Deleted = false; // Track if R2 object has been deleted
    let tempDir = null;
    let checkpoint = null;
    // Heartbeat: update status every 60s to prevent stale detection on frontend
    const heartbeatInterval = setInterval(async () => {
        try {
            await updateStatus(uploadId, { status: 'processing' });
        }
        catch (err) {
            console.warn(`[${uploadId}] Heartbeat update failed (non-fatal):`, err);
        }
    }, 60000);
    try {
        // Track current processing for graceful shutdown handling
        setCurrentProcessingUpload(uploadId);
        console.log(`[${uploadId}] ═══════════════════════════════════════════════`);
        console.log(`[${uploadId}] Starting video processing for user ${userId}`);
        console.log(`[${uploadId}] R2 Key: ${r2Key}`);
        console.log(`[${uploadId}] Detection mode: ${detectionMode}`);
        // Load or create checkpoint for resumable processing
        checkpoint = await getOrCreateCheckpoint(uploadId, userId);
        const isResuming = checkpoint.currentStep !== 'downloading' || checkpoint.completedAudioChunks.length > 0;
        if (isResuming) {
            console.log(`[${uploadId}] ▶️ RESUMING from step: ${checkpoint.currentStep}`);
            console.log(`[${uploadId}]   - Completed audio chunks: ${checkpoint.completedAudioChunks.length}/${checkpoint.totalAudioChunks || '?'}`);
            console.log(`[${uploadId}]   - Completed OCR scenes: ${checkpoint.completedOcrScenes.length}/${checkpoint.totalScenes || '?'}`);
        }
        // Security: Initialize status with userId for access control
        try {
            await initStatus(uploadId, userId);
        }
        catch (statusError) {
            console.warn(`[${uploadId}] Failed to initialize Supabase status (continuing):`, statusError);
            if (process.env.NODE_ENV === 'production') {
                throw statusError;
            }
        }
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'video-analyzer-'));
        const videoPath = path.join(tempDir, 'video.mp4');
        const audioPath = path.join(tempDir, 'audio.mp3');
        try {
            // Ref object to track R2 deletion status (passed by reference to helper function)
            const r2DeletedRef = { value: false };
            // Type assertion: checkpoint is guaranteed to be non-null after getOrCreateCheckpoint
            const cp = checkpoint;
            const stepOrder = [
                'downloading', 'audio_extraction', 'transcription', 'scene_detection', 'ocr', 'excel_generation'
            ];
            const getStepIndex = (step) => stepOrder.indexOf(step);
            const shouldRunStep = (step) => getStepIndex(cp.currentStep) <= getStepIndex(step);
            // Step 1: Download video from R2, delete source, and compress if needed
            // Skip if already completed (resuming from later step)
            if (shouldRunStep('downloading')) {
                await downloadAndPrepareVideo(uploadId, r2Key, videoPath, r2DeletedRef, userId);
                r2Deleted = r2DeletedRef.value;
                // Save checkpoint: download complete
                cp.currentStep = 'audio_extraction';
                await saveCheckpoint(cp);
            }
            else {
                console.log(`[${uploadId}] ⏭️ Skipping download (resuming from ${cp.currentStep})`);
                // For resume: download video from intermediate storage or original R2 key
                try {
                    if (cp.intermediateVideoPath) {
                        await downloadFromR2Parallel(cp.intermediateVideoPath, videoPath);
                    }
                    else {
                        // Try downloading from original R2 key (may have been deleted)
                        await downloadFromR2Parallel(r2Key, videoPath);
                    }
                }
                catch (downloadErr) {
                    console.error(`[${uploadId}] ❌ Failed to download video for resume: ${downloadErr}`);
                    throw new Error(`Cannot resume: video file not available. Please re-upload.`);
                }
                // R2 source is still available for retry — don't assume deleted
            }
            // Step 2-3: Extract metadata and audio
            // Skip audio extraction if already completed
            let videoMetadata;
            let hasAudio;
            if (shouldRunStep('audio_extraction')) {
                const result = await extractMetadataAndAudio(uploadId, videoPath, audioPath);
                videoMetadata = result.videoMetadata;
                hasAudio = result.hasAudio;
                // Save checkpoint: audio extraction complete
                cp.currentStep = 'transcription';
                cp.videoDuration = videoMetadata.duration;
                await saveCheckpoint(cp);
            }
            else {
                console.log(`[${uploadId}] ⏭️ Skipping audio extraction (resuming from ${cp.currentStep})`);
                videoMetadata = await getVideoMetadata(videoPath);
                hasAudio = await hasAudioStream(videoPath);
            }
            // Step 4: Perform VAD + Whisper transcription AND scene detection in parallel
            // These are independent operations that can run concurrently to save time
            let transcription;
            let vadStats = null;
            let preDetectedScenes;
            if (shouldRunStep('transcription')) {
                // Run Whisper + Scene Detection in parallel
                const result = await performParallelProcessing(uploadId, videoPath, audioPath, hasAudio, cp, videoMetadata);
                transcription = result.transcription;
                vadStats = result.vadStats;
                preDetectedScenes = result.preDetectedScenes;
                // Save checkpoint: transcription + scene detection complete
                cp.currentStep = 'scene_detection';
                cp.transcriptionSegments = transcription;
                // Also save scene cuts to checkpoint for resume support
                if (preDetectedScenes.length > 0) {
                    cp.sceneCuts = preDetectedScenes.map(scene => ({
                        timestamp: scene.startTime,
                        confidence: 0.95,
                        source: 'ffmpeg_standard',
                    }));
                }
                await saveCheckpoint(cp);
            }
            else if (cp.transcriptionSegments.length > 0) {
                console.log(`[${uploadId}] ⏭️ Using cached transcription (${cp.transcriptionSegments.length} segments)`);
                transcription = cp.transcriptionSegments;
            }
            else {
                // Should not happen, but fallback to empty transcription
                console.warn(`[${uploadId}] ⚠️ No cached transcription, proceeding with empty`);
                transcription = [];
            }
            // Step 5: Execute scene detection, OCR, and Excel generation
            // Resume from checkpoint if partially completed
            // Pass pre-detected scenes from parallel processing (if available)
            const { excelPath, stats } = await executeSceneDetectionAndOCRWithCheckpoint(uploadId, videoPath, fileName, transcription, detectionMode, cp, preDetectedScenes, videoMetadata);
            // Step 6: Upload result and complete processing
            await uploadResultAndComplete(uploadId, excelPath, videoMetadata, transcription, stats, overallStartTime, detectionMode, userId);
            // Cleanup checkpoint on successful completion
            await deleteCheckpoint(uploadId);
            console.log(`[${uploadId}] ✅ Checkpoint deleted (processing complete)`);
        }
        finally {
            // Cleanup temporary directory
            if (tempDir) {
                fs.rmSync(tempDir, { recursive: true, force: true });
            }
        }
    }
    catch (error) {
        console.error(`[${uploadId}] Processing failed:`, error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
        await failStatus(uploadId, errorMessage);
    }
    finally {
        clearInterval(heartbeatInterval);
        // CRITICAL: Always delete the source R2 object, even on error
        // This prevents storage quota exhaustion
        if (!r2Deleted) {
            console.log(`[${uploadId}] Attempting final R2 cleanup...`);
            try {
                await deleteFromR2(r2Key);
                console.log(`[${uploadId}] ✅ R2 object deleted in final cleanup`);
            }
            catch (deleteError) {
                // Ignore 404 errors (object already deleted)
                const errorMessage = deleteError instanceof Error ? deleteError.message : String(deleteError);
                if (errorMessage.includes('404') || errorMessage.includes('not found') || errorMessage.includes('NoSuchKey')) {
                    console.log(`[${uploadId}] ℹ️  R2 object already deleted (404), skipping`);
                }
                else {
                    console.error(`[${uploadId}] ❌ CRITICAL: Failed to delete R2 object in final cleanup:`, deleteError);
                    // Log to error tracking service (Cloud Monitoring)
                    logCriticalError(deleteError instanceof Error ? deleteError : new Error(String(deleteError)), {
                        uploadId,
                        r2Key,
                        operation: 'r2_cleanup',
                        stage: 'final_cleanup',
                    });
                }
            }
        }
        // Clear current processing tracking (job completed or failed)
        setCurrentProcessingUpload(null);
        console.log(`[${uploadId}] Processing tracking cleared`);
    }
};
/**
 * Download video from R2, delete source, and compress if needed
 * Phase 1 progress: 0-30% (download 0-20%, compress 20-30%)
 *
 * @param uploadId - Upload ID for logging
 * @param r2Key - Source video R2 key
 * @param videoPath - Destination path for video
 * @param r2Deleted - Ref object to track R2 deletion status
 * @param userId - User ID for logging
 * @returns void
 */
async function downloadAndPrepareVideo(uploadId, r2Key, videoPath, r2Deleted, userId) {
    // Phase 1 Step 1: Download video directly from R2 using AWS SDK
    // Phase 1 progress: 0-20%
    await updatePhaseProgress(uploadId, 1, 0, {
        phaseStatus: 'in_progress',
        subTask: 'Downloading video...',
        stage: 'downloading',
    });
    await timeStep(uploadId, 'Download Video from R2 (Parallel)', async () => {
        // Download directly from R2 using parallel chunk downloads for high-speed transfer
        console.log(`[${uploadId}] Starting parallel download from R2: ${r2Key}`);
        await downloadFromR2Parallel(r2Key, videoPath, {
            chunkSize: 50 * 1024 * 1024, // 50MB chunks
            concurrency: 5, // 5 parallel downloads
            onProgress: async (downloaded, total) => {
                const progressPercent = downloaded / total;
                // Phase 1 progress: 0-20% for download
                const phaseProgress = Math.round(progressPercent * 20);
                const downloadedMB = (downloaded / 1024 / 1024).toFixed(0);
                const totalMB = (total / 1024 / 1024).toFixed(0);
                await updatePhaseProgress(uploadId, 1, phaseProgress, {
                    subTask: `Downloading ${downloadedMB}MB / ${totalMB}MB`,
                    stage: 'downloading',
                });
            },
        });
    });
    // R2 source video is NOT deleted here — it must remain available for
    // Cloud Tasks retries (e.g. after SIGTERM at 30 min).
    // Deletion happens in the finally block of processVideo() after processing
    // completes or fails permanently.
    // Phase 1 Step 2: Compress video if needed
    // Phase 1 progress: 20-30%
    await updatePhaseProgress(uploadId, 1, 20, {
        subTask: 'Checking resolution...',
        stage: 'compressing',
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
        }
        else {
            const sizeMB = (compressionResult.originalSize / 1024 / 1024).toFixed(1);
            console.log(`[${uploadId}] ℹ️  Compression skipped: ${sizeMB}MB (below 4K resolution)`);
        }
    }
    catch (compressionError) {
        console.warn(`[${uploadId}] ⚠️  Compression failed, continuing with original file:`, compressionError);
        // Continue processing with original file (compression failure is not fatal)
    }
    // Phase 1 progress: 30% complete
    await updatePhaseProgress(uploadId, 1, 30, {
        subTask: 'Video ready',
        stage: 'compressing',
    });
}
/**
 * Extract video metadata and audio (if available)
 * Phase 1 progress: 30-50% (metadata 30-35%, audio detection 35-40%, audio extraction 40-50%)
 *
 * @param uploadId - Upload ID for logging
 * @param videoPath - Path to video file
 * @param audioPath - Destination path for audio
 * @returns Object containing video metadata and hasAudio flag
 */
async function extractMetadataAndAudio(uploadId, videoPath, audioPath) {
    // Phase 1 Step 3: Extract video metadata
    // Phase 1 progress: 30-35%
    await updatePhaseProgress(uploadId, 1, 30, {
        subTask: 'Reading video info...',
        stage: 'metadata',
    });
    const videoMetadata = await timeStep(uploadId, 'Extract Video Metadata', async () => {
        return await getVideoMetadata(videoPath);
    });
    await updatePhaseProgress(uploadId, 1, 35, {
        subTask: 'Video info extracted',
        stage: 'metadata',
    });
    // Phase 1 Step 4: Detect and extract audio (Whisper-optimized)
    // Phase 1 progress: 35-50%
    await updatePhaseProgress(uploadId, 1, 35, {
        subTask: 'Detecting audio...',
        stage: 'audio',
    });
    const hasAudio = await timeStep(uploadId, 'Detect Audio Stream', async () => {
        return await hasAudioStream(videoPath);
    });
    if (hasAudio) {
        await updatePhaseProgress(uploadId, 1, 40, {
            subTask: 'Extracting audio...',
            stage: 'audio',
        });
        await timeStep(uploadId, 'Extract Audio (16kHz mono)', async () => {
            await extractAudioForWhisper(videoPath, audioPath);
        });
        // Audio preprocessing for improved VAD detection (BGM suppression + voice enhancement)
        // Re-enabled after baseline test completion (2025-11-12)
        await updatePhaseProgress(uploadId, 1, 45, {
            subTask: 'Enhancing audio quality...',
            stage: 'audio',
        });
        await timeStep(uploadId, 'Preprocess Audio (BGM suppression)', async () => {
            try {
                await preprocessAudioForVAD(audioPath, uploadId);
                console.log(`[${uploadId}] ✓ Audio preprocessing successful - VAD detection should improve`);
            }
            catch (preprocessError) {
                // Non-fatal error: Continue with original audio (fallback)
                console.warn(`[${uploadId}] ⚠️ Audio preprocessing failed, using original audio:`, preprocessError);
                console.warn(`[${uploadId}]    VAD detection may be less accurate without preprocessing`);
                // Do not throw - processing continues with original audio
            }
        });
        await updatePhaseProgress(uploadId, 1, 50, {
            subTask: 'Audio ready',
            stage: 'audio',
        });
    }
    else {
        console.log(`[${uploadId}] ⚠️ No audio stream detected, skipping audio extraction`);
        await updatePhaseProgress(uploadId, 1, 50, {
            subTask: 'No audio detected',
            stage: 'audio_skipped',
        });
    }
    return { videoMetadata, hasAudio };
}
/**
 * Perform VAD + Whisper transcription with checkpoint support
 * Resumes from partially completed audio chunks
 *
 * @param uploadId - Upload ID for logging
 * @param audioPath - Path to audio file
 * @param hasAudio - Whether audio stream exists
 * @param checkpoint - Processing checkpoint for resume support
 * @returns Object containing transcription segments and VAD statistics
 */
async function performTranscriptionWithCheckpoint(uploadId, audioPath, hasAudio, checkpoint) {
    // If no audio, skip transcription
    if (!hasAudio) {
        console.log(`[${uploadId}] ⚠️ No audio stream detected, skipping transcription`);
        await skipPhase(uploadId, 1, 'No audio detected');
        return { transcription: [], vadStats: null };
    }
    // Check for partially completed transcription
    const completedChunks = checkpoint.completedAudioChunks;
    const cachedSegments = checkpoint.transcriptionSegments;
    if (completedChunks.length > 0) {
        console.log(`[${uploadId}] ▶️ Resuming transcription from chunk ${completedChunks.length}`);
        console.log(`[${uploadId}]   - Cached segments: ${cachedSegments.length}`);
    }
    // Perform transcription (audioWhisperPipeline will handle checkpoint internally)
    const pipelineResult = await timeStep(uploadId, 'VAD + Whisper Pipeline (Resumable)', async () => {
        return await processAudioWithVADAndWhisper(audioPath, uploadId, checkpoint);
    });
    const transcription = pipelineResult.segments;
    const vadStats = pipelineResult.vadStats;
    console.log(`[${uploadId}] VAD + Whisper complete: ${transcription.length} segments`);
    console.log(`[${uploadId}]   Voice ratio: ${(vadStats.voiceRatio * 100).toFixed(1)}%`);
    console.log(`[${uploadId}]   Cost savings: ${vadStats.estimatedSavings.toFixed(1)}%`);
    // Phase 1 complete
    await completePhase(uploadId, 1);
    console.log(`[${uploadId}] ✅ Phase 1 complete: Listening to narration`);
    return { transcription, vadStats };
}
/**
 * Perform Whisper transcription and scene detection in parallel
 * These two operations are completely independent and can run concurrently.
 * This saves 15-25 minutes on 2-hour videos by overlapping I/O-bound and CPU-bound work.
 *
 * @param uploadId - Upload ID for logging
 * @param videoPath - Path to video file
 * @param audioPath - Path to audio file
 * @param hasAudio - Whether audio stream exists
 * @param checkpoint - Processing checkpoint for resume support
 * @returns Object containing transcription, VAD stats, and pre-detected scenes
 */
async function performParallelProcessing(uploadId, videoPath, audioPath, hasAudio, checkpoint, videoMetadata) {
    console.log(`[${uploadId}] ═══════════════════════════════════════════════`);
    console.log(`[${uploadId}] [PARALLEL] Starting parallel Whisper + Scene Detection`);
    console.log(`[${uploadId}] ═══════════════════════════════════════════════`);
    const parallelStartTime = Date.now();
    // Track whether Whisper has completed, so scene detection can update Phase 2 UI
    let whisperCompleted = false;
    // Run Whisper and Scene Detection in parallel using Promise.allSettled
    const [whisperResult, sceneResult] = await Promise.allSettled([
        // Task 1: Whisper transcription (with checkpoint support)
        timeStep(uploadId, '[PARALLEL] Whisper Transcription', async () => {
            const result = await performTranscriptionWithCheckpoint(uploadId, audioPath, hasAudio, checkpoint);
            whisperCompleted = true;
            return result;
        }),
        // Task 2: Scene detection only (no frame extraction)
        timeStep(uploadId, '[PARALLEL] Scene Detection', async () => {
            console.log(`[${uploadId}] [PARALLEL] Starting scene detection...`);
            const { scenes } = await detectScenesOnly(videoPath, videoMetadata, 
            // Progress callback: update Phase 2 UI after Whisper completes
            async (currentTime, totalDuration, formattedProgress) => {
                console.log(`[${uploadId}] [PARALLEL] Scene detection progress: ${formattedProgress}`);
                // After Whisper completes Phase 1, show scene detection progress on Phase 2
                // This prevents the UI from appearing stuck between Phase 1 and Phase 2
                if (whisperCompleted && totalDuration > 0) {
                    const scenePercent = currentTime / totalDuration;
                    const phaseProgress = Math.round(scenePercent * 25); // 0-25% of Phase 2
                    await updatePhaseProgress(uploadId, 2, phaseProgress, {
                        phaseStatus: 'in_progress',
                        subTask: `Detecting scenes: ${formattedProgress}`,
                        stage: 'scene_detection',
                    });
                }
            });
            console.log(`[${uploadId}] [PARALLEL] Scene detection complete: ${scenes.length} scenes`);
            return scenes;
        }),
    ]);
    const parallelDuration = ((Date.now() - parallelStartTime) / 1000).toFixed(2);
    console.log(`[${uploadId}] [PARALLEL] Both tasks settled in ${parallelDuration}s`);
    // Process results
    let transcription = [];
    let vadStats = null;
    let preDetectedScenes = [];
    // Handle Whisper result
    if (whisperResult.status === 'fulfilled') {
        transcription = whisperResult.value.transcription;
        vadStats = whisperResult.value.vadStats;
        console.log(`[${uploadId}] [PARALLEL] ✅ Whisper succeeded: ${transcription.length} segments`);
    }
    else {
        // Whisper failure is non-fatal: proceed with empty transcription
        console.warn(`[${uploadId}] [PARALLEL] ⚠️ Whisper failed (non-fatal): ${whisperResult.reason}`);
        console.warn(`[${uploadId}] [PARALLEL] Continuing with empty transcription (OCR-only Excel)`);
    }
    // Handle Scene Detection result
    if (sceneResult.status === 'fulfilled') {
        preDetectedScenes = sceneResult.value;
        console.log(`[${uploadId}] [PARALLEL] ✅ Scene detection succeeded: ${preDetectedScenes.length} scenes`);
    }
    else {
        // Scene detection failure is fatal: cannot proceed without scenes
        console.error(`[${uploadId}] [PARALLEL] ❌ Scene detection FAILED: ${sceneResult.reason}`);
        throw new Error(`Scene detection failed: ${sceneResult.reason}`);
    }
    console.log(`[${uploadId}] [PARALLEL] Results: ${transcription.length} segments, ${preDetectedScenes.length} scenes`);
    return { transcription, vadStats, preDetectedScenes };
}
/**
 * Execute scene detection, OCR, and Excel generation with checkpoint support
 *
 * @param uploadId - Upload ID for logging
 * @param videoPath - Path to video file
 * @param fileName - Original file name
 * @param transcription - Transcription segments
 * @param detectionMode - Detection mode ('standard' or 'enhanced')
 * @param checkpoint - Processing checkpoint for resume support
 * @param preDetectedScenes - Pre-detected scenes from parallel processing (optional)
 * @returns Object containing Excel path and pipeline statistics
 */
async function executeSceneDetectionAndOCRWithCheckpoint(uploadId, videoPath, fileName, transcription, detectionMode = 'standard', checkpoint, preDetectedScenes, videoMetadata) {
    // Phase 2 starts: Scene detection + OCR
    await updatePhaseProgress(uploadId, 2, 0, {
        phaseStatus: 'in_progress',
        subTask: preDetectedScenes ? 'Using pre-detected scenes...' : 'Starting scene detection...',
        stage: 'scene_detection',
        estimatedTimeRemaining: preDetectedScenes ? undefined : 'About 3-8 min (estimate)',
    });
    const pipelineResult = await timeStep(uploadId, 'Scene Detection + OCR + Excel Generation (Resumable)', async () => {
        return await executeIdealPipeline(videoPath, fileName, transcription, uploadId, detectionMode, checkpoint, preDetectedScenes, videoMetadata);
    });
    return {
        excelPath: pipelineResult.excelPath,
        stats: pipelineResult.stats
    };
}
/**
 * Upload result file and complete processing status
 * Phase 3 progress: 70-100% (upload 70-95%, finalize 95-100%)
 *
 * @param uploadId - Upload ID for logging
 * @param excelPath - Path to Excel file
 * @param videoMetadata - Video metadata
 * @param transcription - Transcription segments
 * @param stats - Pipeline statistics
 * @param overallStartTime - Overall processing start time
 * @param detectionMode - Detection mode used for processing
 * @param userId - User ID for R2 key generation
 * @returns Result URL and R2 key (if in production)
 */
async function uploadResultAndComplete(uploadId, excelPath, videoMetadata, transcription, stats, overallStartTime, detectionMode = 'standard', userId = 'system') {
    // Phase 3 Step 3: Upload result file or store locally for development
    // Phase 3 progress: 70-95%
    await updatePhaseProgress(uploadId, 3, 70, {
        subTask: 'Uploading result...',
        stage: 'upload_result',
    });
    let resultUrl = uploadId; // Initialize with uploadId
    let resultR2Key = null;
    await timeStep(uploadId, 'Upload Result File', async () => {
        if (process.env.NODE_ENV === 'development') {
            // Development mode: Store file path locally
            const persistentPath = path.join('/tmp', `result_${uploadId}.xlsx`);
            fs.copyFileSync(excelPath, persistentPath);
            resultFileMap.set(uploadId, persistentPath);
            console.log(`[${uploadId}] Development mode: File stored at ${persistentPath}`);
            console.log(`[${uploadId}] Result URL (uploadId): ${resultUrl}`);
        }
        else {
            // Production mode: Upload to R2
            resultR2Key = await uploadResultFile(excelPath, uploadId, userId);
            console.log(`[${uploadId}] Production mode: Uploaded to R2`);
            console.log(`[${uploadId}] R2 Key: ${resultR2Key}`);
            console.log(`[${uploadId}] Result URL (uploadId): ${resultUrl}`);
        }
    });
    // Complete with metadata (including resultR2Key for production downloads)
    console.log(`[${uploadId}] Processing completed!`);
    const completionMetadata = {
        duration: videoMetadata.duration,
        segmentCount: transcription.length,
        ocrResultCount: stats.scenesWithOCRText,
        transcriptionLength: transcription.reduce((sum, seg) => sum + seg.text.length, 0),
        totalScenes: stats.totalScenes,
        scenesWithOCR: stats.scenesWithOCRText,
        scenesWithNarration: stats.scenesWithNarration,
        detectionMode,
        // Enhanced mode metadata (populated by pipeline if enhanced mode was used)
        luminanceTransitionsDetected: stats.luminanceTransitionsDetected,
        textStabilizationPoints: stats.textStabilizationPoints,
    };
    // Store resultR2Key in metadata for production downloads
    if (resultR2Key) {
        completionMetadata.resultR2Key = resultR2Key;
    }
    // Phase 3 complete: Mark as 100% before final status update
    await updatePhaseProgress(uploadId, 3, 95, {
        subTask: 'Finalizing...',
        stage: 'upload_result',
    });
    // Try to update Supabase status, but don't fail if it errors (dev mode resilience)
    try {
        // Complete Phase 3 and overall processing
        await completePhase(uploadId, 3);
        console.log(`[${uploadId}] ✅ Phase 3 complete: Creating your report`);
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
    // Log overall processing time
    const overallDuration = ((Date.now() - overallStartTime) / 1000).toFixed(2);
    console.log(`[${uploadId}] ═══════════════════════════════════════════════`);
    console.log(`[${uploadId}] 🎉 TOTAL PROCESSING TIME: ${overallDuration}s`);
    console.log(`[${uploadId}] ═══════════════════════════════════════════════`);
    return { resultUrl, resultR2Key };
}
/**
 * Compress video if resolution is 4K or higher
 * Downscales to 1080p with CRF 28 and fast preset
 *
 * @param inputPath - Path to the input video file
 * @param uploadId - Upload ID for logging
 * @returns Object containing compression status and file sizes
 */
async function compressVideoIfNeeded(inputPath, uploadId) {
    const COMPRESSION_TIMEOUT_MS = 1200000; // 20 minutes timeout
    const stats = fs.statSync(inputPath);
    const originalSize = stats.size;
    // Check resolution to determine if compression is needed
    const metadata = await getVideoMetadata(inputPath);
    const is4KOrHigher = Math.max(metadata.width, metadata.height) >= 3840;
    if (!is4KOrHigher) {
        console.log(`[${uploadId}] Resolution ${metadata.width}x${metadata.height} is below 4K, skipping compression`);
        return { compressed: false, originalSize, newSize: originalSize };
    }
    console.log(`[${uploadId}] 4K+ detected (${metadata.width}x${metadata.height}), compressing to 1080p...`);
    // Create temporary output path
    const outputPath = inputPath.replace('.mp4', '_compressed.mp4');
    try {
        const startTime = Date.now();
        const ffmpegArgs = [
            '-i', inputPath,
            '-vf', 'scale=-2:1080', // 4K → 1080p (aspect ratio preserved)
            '-vcodec', 'libx264',
            '-crf', '28',
            '-preset', 'fast',
            '-acodec', 'aac',
            '-b:a', '96k',
            '-movflags', '+faststart',
            '-y',
            outputPath
        ];
        console.log(`[${uploadId}] Running ffmpeg compression (1080p, CRF 28, fast preset, timeout: ${COMPRESSION_TIMEOUT_MS / 1000}s)...`);
        await execFileAsync('ffmpeg', ffmpegArgs, {
            maxBuffer: 10 * 1024 * 1024,
            timeout: COMPRESSION_TIMEOUT_MS
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
    }
    catch (error) {
        // Clean up temporary file if it exists
        if (fs.existsSync(outputPath)) {
            fs.unlinkSync(outputPath);
        }
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error(`[${uploadId}] Compression failed: ${errorMessage}`);
        throw error;
    }
}
//# sourceMappingURL=videoProcessor.js.map