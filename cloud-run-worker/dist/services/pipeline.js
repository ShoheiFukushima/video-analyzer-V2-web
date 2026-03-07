/**
 * Integrated Video Analysis Pipeline
 * FFmpeg Scene Detection → OCR → Narration Mapping → Excel Generation
 *
 * Implements the ideal workflow for V2:
 * 1. Scene detection with mid-point frame extraction
 * 2. OCR on each scene frame (Gemini Vision)
 * 3. Map narration to scenes based on timestamps
 * 4. Generate Excel with ideal format (Scene # | Timecode | Screenshot | OCR | NA Text)
 */
import { getVideoMetadata, cleanupFrames, extractFrameAtTime, 
// Batch processing functions (memory optimization)
detectScenesOnly, extractFramesForBatch, cleanupBatchFrames, logMemoryUsage, DEFAULT_BATCH_SIZE, } from './ffmpeg.js';
import { generateExcel, generateExcelFilename } from './excel-generator.js';
import { cleanseScenesWithLLM } from './llmCleansing.js';
import { groupScenesByTopic } from './topicGrouping.js';
import { formatTimecode } from '../utils/timecode.js';
import fs from 'fs';
import { promises as fsPromises } from 'fs';
import path from 'path';
import os from 'os';
import pLimit from 'p-limit';
import { getOCRRouter } from './ocrRouter.js';
import { updatePhaseProgress, completePhase } from './statusManager.js';
import { setSceneCuts, addCompletedOcrScenes, OCR_CHECKPOINT_INTERVAL, } from './checkpointService.js';
import { registerOcrProgress, clearOcrProgress } from './emergencyCheckpoint.js';
/**
 * Main pipeline execution
 * @param videoPath - Path to video file
 * @param projectTitle - Project/video title
 * @param transcription - Transcription from whisperService
 * @param uploadId - Optional upload ID for progress tracking
 * @param checkpoint - Optional checkpoint for resumable processing
 * @returns Path to generated Excel file
 */
export async function executeIdealPipeline(videoPath, projectTitle, transcription, uploadId, checkpoint, preDetectedScenes, videoMetadata, warningCollector) {
    console.log('🎬 Starting Ideal Pipeline Execution');
    console.log(`  📹 Video: ${videoPath}`);
    console.log(`  🎙️ Transcription: ${transcription.length} segments`);
    // Helper function for safe phase progress updates
    const safePhaseProgress = async (phase, phaseProgress, subTask, stage, estimatedTime) => {
        if (!uploadId)
            return;
        try {
            await updatePhaseProgress(uploadId, phase, phaseProgress, {
                subTask,
                stage: stage,
                estimatedTimeRemaining: estimatedTime,
            });
        }
        catch (err) {
            console.warn(`Failed to update phase progress: ${err}`);
        }
    };
    // Phase 2 Step 1: Use provided metadata or extract it
    // Phase 2 progress: 0-5%
    await safePhaseProgress(2, 0, 'Reading video metadata...', 'scene_detection');
    console.log('\n📐 Step 1: Video metadata...');
    if (!videoMetadata) {
        videoMetadata = await getVideoMetadata(videoPath);
    }
    else {
        console.log('  ⚡ Using pre-extracted metadata');
    }
    await safePhaseProgress(2, 5, 'Starting scene detection...', 'scene_detection', 'About 2-5 min (estimate)');
    // Phase 2 Step 2: Scene detection
    // Phase 2 progress: 5-25%
    // Check if scenes are already available from parallel processing, checkpoint, or need detection
    let scenes = [];
    const cachedSceneCuts = checkpoint?.sceneCuts || [];
    const isSceneDetectionComplete = checkpoint?.currentStep === 'ocr' && cachedSceneCuts.length > 0;
    if (preDetectedScenes && preDetectedScenes.length > 0) {
        // Pre-detected scenes from parallel processing (Whisper + Scene Detection ran concurrently)
        console.log('\n🎞️ Step 2: Scene detection (PRE-DETECTED from parallel processing)...');
        console.log(`  ⚡ Using ${preDetectedScenes.length} pre-detected scenes (no additional detection needed)`);
        scenes = preDetectedScenes;
        // Save scene cuts to checkpoint for resume support
        if (uploadId && checkpoint) {
            try {
                const sceneCuts = scenes.map(scene => ({
                    timestamp: scene.startTime,
                    confidence: 0.95,
                    source: 'pyscenedetect',
                }));
                await setSceneCuts(uploadId, sceneCuts);
                console.log(`  💾 Saved ${sceneCuts.length} pre-detected scene cuts to checkpoint`);
            }
            catch (err) {
                console.warn(`  ⚠️ Failed to save scene cuts checkpoint: ${err}`);
            }
        }
        await safePhaseProgress(2, 25, `${scenes.length} scenes (pre-detected)`, 'frame_extraction');
    }
    else if (isSceneDetectionComplete) {
        console.log('\n🎞️ Step 2: Scene detection (CACHED)...');
        console.log(`  ▶️ Using ${cachedSceneCuts.length} cached scene cuts from checkpoint`);
        // Convert cached scene cuts to Scene objects
        scenes = cachedSceneCuts.map((cut, index) => {
            const nextCut = cachedSceneCuts[index + 1];
            const startTime = cut.timestamp;
            const endTime = nextCut ? nextCut.timestamp : videoMetadata.duration;
            const midTime = (startTime + endTime) / 2;
            return {
                sceneNumber: index + 1,
                startTime,
                endTime,
                midTime,
                timecode: formatTimecode(startTime),
                screenshotPath: undefined, // Will be extracted later
            };
        });
        await safePhaseProgress(2, 25, `${scenes.length} scenes loaded from checkpoint`, 'frame_extraction');
    }
    else {
        // First, detect scenes only (no frame extraction) for memory optimization
        console.log('\n🎞️ Step 2: Scene detection...');
        await safePhaseProgress(2, 10, 'Detecting scenes ...', 'scene_detection');
        // Progress callback for scene detection (updates UI with current position)
        const sceneDetectionProgress = async (currentTime, totalDuration, formattedProgress) => {
            // Calculate progress: 10-25% is scene detection phase
            const progressPercent = Math.min(24, 10 + Math.floor((currentTime / totalDuration) * 14));
            await safePhaseProgress(2, progressPercent, `Detecting scenes: ${formattedProgress}`, 'scene_detection');
        };
        // Detect scenes without extracting frames (batch processing optimization)
        const { scenes: detectedScenes } = await detectScenesOnly(videoPath, videoMetadata, sceneDetectionProgress);
        scenes = detectedScenes;
        console.log(`  ✓ Detected ${scenes.length} scenes`);
        // Save scene cuts to checkpoint
        if (uploadId && checkpoint) {
            try {
                const sceneCuts = scenes.map(scene => ({
                    timestamp: scene.startTime,
                    confidence: 0.95,
                    source: 'pyscenedetect',
                }));
                await setSceneCuts(uploadId, sceneCuts);
                console.log(`  💾 Saved ${sceneCuts.length} scene cuts to checkpoint`);
            }
            catch (err) {
                console.warn(`  ⚠️ Failed to save scene cuts checkpoint: ${err}`);
            }
        }
    }
    // OCR needs 720px minimum for reliable text extraction
    // Excel uses 320px to keep file size manageable for long videos
    const OCR_FRAME_WIDTH = 720;
    // Determine if batch processing is needed (for memory optimization)
    const useBatchProcessing = shouldUseBatchProcessing(scenes.length);
    if (useBatchProcessing) {
        console.log(`  📦 Batch processing ENABLED (${scenes.length} scenes > threshold)`);
        logMemoryUsage('Before batch decision');
    }
    else {
        // For smaller videos, extract frames at OCR resolution (also used for Excel)
        console.log(`  ⚡ Traditional processing (${scenes.length} scenes - fast path)`);
        const framesDir = path.join(os.tmpdir(), `frames-${Date.now()}`);
        scenes = await extractFramesForBatch(videoPath, scenes, framesDir, videoMetadata, OCR_FRAME_WIDTH);
    }
    await safePhaseProgress(2, 25, `${scenes.length} scenes detected`, 'frame_extraction');
    // Phase 2 Step 3: Perform OCR on each scene frame
    // Phase 2 progress: 25-90% (batch processing) or 40-90% (traditional)
    let scenesWithRawOCR;
    let batchFramesDir; // For short video batch processing (frames kept for Excel)
    if (useBatchProcessing) {
        // Batch processing: extract frames at 720px for OCR
        // Short videos (≤15min): keep frames for Excel reuse
        // Long videos (>15min): cleanup per batch, re-extract at 320px for Excel later
        console.log('\n🔍 Step 3: Batch Processing (Frame Extraction + OCR)...');
        await safePhaseProgress(2, 25, `Starting batch processing on ${scenes.length} scenes...`, 'batch_processing', 'Processing in batches for memory optimization');
        const batchResult = await processScenesInBatches(videoPath, scenes, videoMetadata, uploadId, DEFAULT_BATCH_SIZE, checkpoint, OCR_FRAME_WIDTH);
        scenesWithRawOCR = batchResult.results;
        batchFramesDir = batchResult.framesDir; // undefined for long videos (frames cleaned per batch)
    }
    else {
        // Traditional processing: OCR on already-extracted frames
        await safePhaseProgress(2, 40, `Starting OCR on ${scenes.length} scenes...`, 'ocr_processing', 'About 2-5 min (estimate)');
        console.log('\n🔍 Step 3: Performing OCR on scene frames...');
        scenesWithRawOCR = await performSceneBasedOCR(scenes, uploadId, videoMetadata.duration, checkpoint);
    }
    // Check for OCR failures and add warnings
    if (warningCollector) {
        const ocrFailures = scenesWithRawOCR.filter(s => s.ocrConfidence === 0 && s.ocrText === '').length;
        const totalOcrScenes = scenesWithRawOCR.length;
        if (ocrFailures > 0) {
            warningCollector.add(`OCRテキスト抽出が ${ocrFailures}/${totalOcrScenes} シーンで失敗しました。一部のシーンで画面テキストが欠落している可能性があります。`);
        }
    }
    // Step 3.5: Filter out persistent overlays (logos, watermarks)
    console.log('\n🧹 Step 3.5: Filtering persistent overlays...');
    const scenesWithFilteredOverlays = filterPersistentOverlays(scenesWithRawOCR);
    // Step 3.6: Remove consecutive duplicate OCR text
    console.log('\n🔄 Step 3.6: Removing consecutive duplicate OCR text...');
    const scenesWithOCR = removeConsecutiveDuplicateOCR(scenesWithFilteredOverlays);
    // Phase 2 complete, Phase 3 starts: Create report
    // Complete Phase 2
    if (uploadId) {
        try {
            await completePhase(uploadId, 2);
            console.log(`  ✅ Phase 2 complete: Reading on-screen text`);
        }
        catch (err) {
            console.warn(`Failed to complete Phase 2: ${err}`);
        }
    }
    // Phase 3 Step 1: Map transcription to scenes
    // Phase 3 progress: 0-15%
    await safePhaseProgress(3, 0, 'Mapping narration to scenes...', 'narration_mapping');
    console.log('\n🎙️ Step 4: Mapping transcription to scenes...');
    const scenesWithNarration = mapTranscriptionToScenes(scenesWithOCR, transcription);
    await safePhaseProgress(3, 15, 'Narration mapping complete', 'narration_mapping');
    // Step 4.5: LLM Cleansing (OCR/narration error correction)
    console.log('\n🧹 Step 4.5: LLM Cleansing...');
    await safePhaseProgress(3, 16, 'LLM text cleansing...', 'narration_mapping');
    const sceneTextData = scenesWithNarration.map(s => ({
        sceneNumber: s.sceneNumber,
        ocr: s.ocrText || '',
        narration: s.narrationText || '',
    }));
    const cleansedResults = await cleanseScenesWithLLM(sceneTextData);
    // Apply cleansed results back to scenes
    for (let i = 0; i < scenesWithNarration.length; i++) {
        scenesWithNarration[i].ocrText = cleansedResults[i].ocr;
        scenesWithNarration[i].narrationText = cleansedResults[i].narration;
    }
    await safePhaseProgress(3, 22, 'LLM cleansing complete', 'narration_mapping');
    // Step 4.6: Topic Grouping (group consecutive scenes with similar OCR)
    console.log('\n📚 Step 4.6: Topic Grouping...');
    await safePhaseProgress(3, 23, 'Grouping scenes by topic...', 'narration_mapping');
    const scenesForGrouping = scenesWithNarration.map(s => ({
        sceneNumber: s.sceneNumber,
        startTime: s.startTime,
        endTime: s.endTime,
        ocr: s.ocrText || '',
        narration: s.narrationText || '',
    }));
    const topicGroups = groupScenesByTopic(scenesForGrouping);
    await safePhaseProgress(3, 30, `${topicGroups.length} topics identified`, 'narration_mapping');
    // Step 5: Convert to Excel rows
    console.log('\n📝 Step 5: Converting to Excel rows...');
    const excelRows = convertScenesToExcelRows(scenesWithNarration);
    // Step 5.5: Re-extract frames for Excel (long video batch processing only)
    // Long videos (>15 min) clean up 720px OCR frames per batch to save memory.
    // Re-extract at 320px (~15-30KB/frame) for Excel embedding.
    // Short videos keep 720px frames from OCR phase — no re-extraction needed.
    let excelFramesDir;
    const EXCEL_FRAME_WIDTH = 320;
    if (useBatchProcessing && !batchFramesDir) {
        console.log('\n📸 Step 5.5: Re-extracting frames for Excel (320px wide)...');
        await safePhaseProgress(3, 30, `Re-extracting ${excelRows.length} frames for Excel...`, 'frame_reextraction');
        excelFramesDir = await reExtractFramesForExcel(videoPath, scenesWithNarration, videoMetadata, EXCEL_FRAME_WIDTH);
        for (const row of excelRows) {
            const scene = scenesWithNarration.find(s => s.sceneNumber === row.sceneNumber);
            if (scene) {
                row.screenshotPath = scene.screenshotPath;
            }
        }
        console.log(`  ✓ Re-extracted ${excelRows.length} frames for Excel embedding`);
    }
    // Phase 3 Step 2: Generate Excel file
    // Phase 3 progress: 30-70%
    await safePhaseProgress(3, 40, 'Generating Excel file...', 'excel_generation');
    console.log('\n📊 Step 6: Generating Excel file...');
    const excelFilename = generateExcelFilename(projectTitle);
    const excelPath = path.join('/tmp', excelFilename);
    await safePhaseProgress(3, 50, 'Creating workbook...', 'excel_generation');
    const excelBuffer = await generateExcel({
        projectTitle,
        rows: excelRows,
        videoMetadata,
        includeStatistics: true,
        topicGroups,
        warnings: warningCollector?.getWarnings(),
    });
    // Write Excel buffer to file
    await safePhaseProgress(3, 60, 'Writing Excel file...', 'excel_generation');
    await fsPromises.writeFile(excelPath, excelBuffer);
    await safePhaseProgress(3, 70, 'Excel file created', 'excel_generation');
    // Step 7: Calculate statistics
    const stats = {
        totalScenes: scenes.length,
        scenesWithOCRText: excelRows.filter(r => r.ocrText && r.ocrText.trim().length > 0).length,
        scenesWithNarration: excelRows.filter(r => r.narrationText && r.narrationText.trim().length > 0).length,
        processingTimeMs: 0, // Set by caller
        videoMetadata,
    };
    console.log('\n✅ Ideal Pipeline Execution Complete');
    console.log(`  📊 Excel file: ${excelPath}`);
    console.log(`  📈 Statistics:`, stats);
    // Cleanup frames after Excel generation
    if (!useBatchProcessing) {
        // Traditional processing: clean up full-res frames
        await cleanupFrames(scenes);
    }
    else if (batchFramesDir) {
        // Short video batch processing: clean up kept frames
        try {
            await fsPromises.rm(batchFramesDir, { recursive: true, force: true });
            console.log(`  🧹 Cleaned up batch frames directory: ${batchFramesDir}`);
        }
        catch (e) {
            console.warn(`  ⚠️ Failed to cleanup batch frames directory: ${e}`);
        }
    }
    if (excelFramesDir) {
        try {
            await fsPromises.rm(excelFramesDir, { recursive: true, force: true });
            console.log(`  🧹 Cleaned up Excel frames directory: ${excelFramesDir}`);
        }
        catch (e) {
            console.warn(`  ⚠️ Failed to cleanup Excel frames directory: ${e}`);
        }
    }
    return { excelPath, stats };
}
/**
 * Perform OCR on each scene's frame using Gemini Vision with parallel processing
 * @param scenes - Array of scenes to process
 * @param uploadId - Optional upload ID for progress tracking
 * @returns Array of scenes with OCR results
 */
/**
 * Perform OCR on scenes using multi-provider OCR router
 * Supports: Gemini (primary), Mistral, GLM, OpenAI (fallback)
 * Automatically boosts parallelism for videos > 1 hour
 *
 * @param scenes - Array of scenes to process
 * @param uploadId - Optional upload ID for progress tracking
 * @param videoDuration - Optional video duration in seconds (enables auto-parallel boost for 1h+ videos)
 * @param checkpoint - Optional checkpoint for resumable processing
 * @returns Array of scenes with OCR results
 */
async function performSceneBasedOCR(scenes, uploadId, videoDuration, checkpoint, globalOffset = 0) {
    // Get OCR router singleton
    const ocrRouter = getOCRRouter();
    // Set video duration for automatic parallel boost (1h+ videos)
    if (videoDuration !== undefined) {
        ocrRouter.setVideoDuration(videoDuration);
    }
    // Progress tracking
    const OCR_PHASE_PROGRESS_START = 40;
    const OCR_PHASE_PROGRESS_END = 90;
    // Check for cached OCR results from checkpoint
    const cachedOcrResults = checkpoint?.ocrResults || {};
    const completedOcrScenes = new Set(checkpoint?.completedOcrScenes || []);
    const hasCachedResults = completedOcrScenes.size > 0;
    if (hasCachedResults) {
        console.log(`  ▶️ Resuming OCR processing`);
        console.log(`     - Cached results: ${completedOcrScenes.size}/${scenes.length} scenes`);
        console.log(`     - Remaining: ${scenes.length - completedOcrScenes.size} scenes`);
    }
    console.log(`  🚀 Starting multi-provider OCR processing (${scenes.length} scenes)`);
    console.log(`  📡 Available providers: ${ocrRouter.getAvailableProviderCount()}`);
    if (videoDuration && videoDuration > 3600) {
        console.log(`  ⚡ Long video mode enabled (${(videoDuration / 60).toFixed(1)} min) - parallel boost active`);
    }
    const startTime = Date.now();
    // Prepare image tasks (read all screenshots), skipping cached results
    const tasks = [];
    const sceneIndices = [];
    for (let i = 0; i < scenes.length; i++) {
        const scene = scenes[i];
        const globalIndex = globalOffset + i;
        // Skip scenes that already have cached OCR results
        if (completedOcrScenes.has(globalIndex)) {
            continue; // Will be populated from cache later
        }
        if (scene.screenshotPath) {
            try {
                const imageBuffer = fs.readFileSync(scene.screenshotPath);
                tasks.push({
                    id: scene.sceneNumber,
                    imageBuffer,
                    metadata: { sceneIndex: globalIndex },
                });
                sceneIndices.push(globalIndex);
            }
            catch (err) {
                console.warn(`  ⚠️ Scene ${scene.sceneNumber}: Failed to read screenshot: ${err}`);
            }
        }
        else {
            console.log(`  ⚠️ Scene ${scene.sceneNumber}: No screenshot, skipping OCR`);
        }
    }
    const cachedCount = completedOcrScenes.size;
    console.log(`  📸 Loaded ${tasks.length}/${scenes.length} screenshots for OCR (${cachedCount} cached)`);
    // If all scenes are cached, skip OCR processing
    if (tasks.length === 0 && cachedCount > 0) {
        console.log(`  ✓ All OCR results loaded from cache`);
        const scenesWithOCR = scenes.map((scene, i) => ({
            ...scene,
            ocrText: cachedOcrResults[globalOffset + i] || '',
            ocrConfidence: cachedOcrResults[globalOffset + i] ? 0.95 : 0,
        }));
        return scenesWithOCR;
    }
    // Update progress before starting batch processing
    if (uploadId) {
        try {
            await updatePhaseProgress(uploadId, 2, OCR_PHASE_PROGRESS_START, {
                subTask: `OCR: Processing ${tasks.length} scenes...`,
                stage: 'ocr_processing',
            });
        }
        catch (err) {
            console.warn(`Failed to update OCR progress: ${err}`);
        }
    }
    // Process all images in parallel using OCR router
    const batchResult = await ocrRouter.processParallel(tasks);
    // Map results back to scenes (initialize with cached results using global indices)
    const scenesWithOCR = scenes.map((scene, i) => ({
        ...scene,
        ocrText: cachedOcrResults[globalOffset + i] || '',
        ocrConfidence: cachedOcrResults[globalOffset + i] ? 0.95 : 0,
    }));
    // Populate OCR results from new processing
    const newOcrResults = {};
    const newCompletedScenes = [];
    let lastSavedIndex = -1; // Track last checkpoint-saved index for emergency save
    for (let i = 0; i < batchResult.results.length; i++) {
        const result = batchResult.results[i];
        const sceneIndex = sceneIndices[i]; // Global index
        if (sceneIndex !== undefined) {
            const localIndex = sceneIndex - globalOffset;
            scenesWithOCR[localIndex].ocrText = result.text;
            scenesWithOCR[localIndex].ocrConfidence = result.confidence;
            // Track for checkpoint (use global index)
            newOcrResults[sceneIndex] = result.text;
            newCompletedScenes.push(sceneIndex);
            // Register progress for emergency save on SIGTERM
            if (uploadId) {
                registerOcrProgress(uploadId, newCompletedScenes, newOcrResults, lastSavedIndex);
            }
            // Log result
            const scene = scenesWithOCR[localIndex];
            const textPreview = result.text.length > 0
                ? result.text.substring(0, 50).replace(/\n/g, ' ')
                : '(no text)';
            console.log(`  ✓ Scene ${scene.sceneNumber}: OCR complete ` +
                `(text: ${result.text.length} chars, confidence: ${result.confidence.toFixed(2)}, provider: ${result.provider})`);
            if (result.text.length > 0) {
                console.log(`    Preview: "${textPreview}${result.text.length > 50 ? '...' : ''}"`);
            }
            // Save checkpoint every OCR_CHECKPOINT_INTERVAL scenes
            if (uploadId && checkpoint && newCompletedScenes.length > 0 && newCompletedScenes.length % OCR_CHECKPOINT_INTERVAL === 0) {
                try {
                    await addCompletedOcrScenes(uploadId, newCompletedScenes, newOcrResults);
                    lastSavedIndex = Math.max(...newCompletedScenes); // Update last saved index
                    console.log(`  💾 OCR Checkpoint saved: ${completedOcrScenes.size + newCompletedScenes.length}/${scenes.length} scenes`);
                }
                catch (err) {
                    console.warn(`  ⚠️ Failed to save OCR checkpoint: ${err}`);
                }
            }
        }
    }
    // Save final OCR checkpoint
    if (uploadId && checkpoint && newCompletedScenes.length > 0) {
        try {
            await addCompletedOcrScenes(uploadId, newCompletedScenes, newOcrResults);
            console.log(`  💾 Final OCR checkpoint saved: ${completedOcrScenes.size + newCompletedScenes.length}/${scenes.length} scenes`);
        }
        catch (err) {
            console.warn(`  ⚠️ Failed to save final OCR checkpoint: ${err}`);
        }
    }
    // Clear emergency checkpoint state (OCR complete)
    if (uploadId) {
        clearOcrProgress();
    }
    // Calculate and log performance metrics
    const duration = (Date.now() - startTime) / 1000;
    console.log(`\n  ✓ Multi-provider OCR completed in ${duration.toFixed(2)}s`);
    console.log(`  📊 Average: ${(duration / scenes.length).toFixed(2)}s per scene`);
    console.log(`  📈 Stats: ${batchResult.stats.successCount}/${batchResult.stats.totalProcessed} succeeded`);
    console.log(`  🔀 Provider usage:`, batchResult.stats.providerUsage);
    // Log router status
    ocrRouter.logStatus();
    // Final progress report - Phase 2 at 95% (OCR complete)
    if (uploadId) {
        try {
            await updatePhaseProgress(uploadId, 2, OCR_PHASE_PROGRESS_END + 5, {
                subTask: 'OCR processing complete',
                stage: 'ocr_completed',
            });
        }
        catch (err) {
            console.warn(`Failed to update final OCR progress: ${err}`);
        }
    }
    const scenesWithText = scenesWithOCR.filter((s) => s.ocrText).length;
    console.log(`  ✓ OCR complete: ${scenesWithText}/${scenes.length} scenes with text`);
    return scenesWithOCR;
}
// ============================================================
// Batch Processing Functions (Memory Optimization)
// Added: 2026-02-06
// Purpose: Process frames in batches to reduce peak memory usage
// ============================================================
/**
 * Process scenes in batches: extract frames → OCR → cleanup
 * This approach reduces peak memory from 3-5GB to ~500MB-1GB
 *
 * @param videoPath - Path to video file
 * @param scenes - All scenes (without screenshots)
 * @param videoMetadata - Video metadata for frame extraction
 * @param uploadId - Optional upload ID for progress tracking
 * @param batchSize - Number of scenes per batch (default: 100)
 * @param checkpoint - Optional checkpoint for resumable processing
 * @returns Scenes with OCR results
 */
async function processScenesInBatches(videoPath, scenes, videoMetadata, uploadId, batchSize = DEFAULT_BATCH_SIZE, checkpoint, frameWidth) {
    // Short videos (≤15min): keep 720px frames for Excel reuse (no re-extraction)
    // Long videos (>15min): cleanup 720px frames per batch, re-extract at 320px for Excel later
    const LONG_VIDEO_THRESHOLD = 15 * 60; // 15 minutes
    const isLongVideo = videoMetadata.duration > LONG_VIDEO_THRESHOLD;
    console.log('\n📦 Starting Batch Processing (Memory Optimized)');
    console.log(`  📊 Total scenes: ${scenes.length}`);
    console.log(`  📦 Batch size: ${batchSize}`);
    console.log(`  🔢 Total batches: ${Math.ceil(scenes.length / batchSize)}`);
    console.log(`  📐 Frame width: ${frameWidth || 'full resolution'}px`);
    console.log(`  🎬 Video duration: ${(videoMetadata.duration / 60).toFixed(1)} min → ${isLongVideo ? 'Long video (re-extract for Excel)' : 'Short video (keep frames for Excel)'}`);
    logMemoryUsage('Before batch processing');
    const allResults = [];
    const framesDir = path.join(os.tmpdir(), `batch-frames-${Date.now()}`);
    // Create frames directory
    await fsPromises.mkdir(framesDir, { recursive: true });
    const totalBatches = Math.ceil(scenes.length / batchSize);
    const startTime = Date.now();
    // Track batch timing for ETA calculation
    let batchTimes = [];
    // Helper for safe progress updates with ETA
    const safePhaseProgress = async (phaseProgress, subTask, estimatedTimeRemaining) => {
        if (!uploadId)
            return;
        try {
            await updatePhaseProgress(uploadId, 2, phaseProgress, {
                subTask,
                stage: 'batch_processing',
                estimatedTimeRemaining,
            });
        }
        catch (err) {
            console.warn(`Failed to update batch progress: ${err}`);
        }
    };
    // Format remaining time for display
    const formatTimeRemaining = (seconds) => {
        if (seconds < 60) {
            return `About ${Math.ceil(seconds)} seconds remaining`;
        }
        else if (seconds < 3600) {
            const minutes = Math.ceil(seconds / 60);
            return `About ${minutes} minute${minutes > 1 ? 's' : ''} remaining`;
        }
        else {
            const hours = Math.floor(seconds / 3600);
            const minutes = Math.ceil((seconds % 3600) / 60);
            return `About ${hours}h ${minutes}m remaining`;
        }
    };
    for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
        const batchStartTime = Date.now();
        const batchStart = batchIndex * batchSize;
        const batchEnd = Math.min(batchStart + batchSize, scenes.length);
        const batchScenes = scenes.slice(batchStart, batchEnd);
        const batchNumber = batchIndex + 1;
        console.log(`\n━━━ Batch ${batchNumber}/${totalBatches} (scenes ${batchStart + 1}-${batchEnd}) ━━━`);
        logMemoryUsage(`Batch ${batchNumber} start`);
        // Calculate progress (25-90% for batch processing)
        const batchProgress = 25 + Math.floor((batchIndex / totalBatches) * 65);
        // Calculate ETA based on previous batch times
        let estimatedTimeRemaining;
        if (batchTimes.length > 0) {
            const avgBatchTime = batchTimes.reduce((a, b) => a + b, 0) / batchTimes.length;
            const remainingBatches = totalBatches - batchIndex;
            const remainingSeconds = (avgBatchTime / 1000) * remainingBatches;
            estimatedTimeRemaining = formatTimeRemaining(remainingSeconds);
        }
        else if (batchIndex === 0) {
            // First batch: provide rough estimate based on typical processing time
            // ~0.5 seconds per scene is a reasonable estimate
            const roughEstimate = scenes.length * 0.5;
            estimatedTimeRemaining = formatTimeRemaining(roughEstimate);
        }
        await safePhaseProgress(batchProgress, `Batch ${batchNumber}/${totalBatches}: Processing ${batchScenes.length} scenes...`, estimatedTimeRemaining);
        // Step 1: Extract frames for this batch at reduced resolution
        console.log(`  [1/2] Extracting ${batchScenes.length} frames...`);
        const batchScenesWithFrames = await extractFramesForBatch(videoPath, batchScenes, framesDir, videoMetadata, frameWidth);
        logMemoryUsage(`Batch ${batchNumber} after frame extraction`);
        // Step 2: Run OCR for this batch (pass video duration for long video optimization)
        console.log(`  [2/${isLongVideo ? '3' : '2'}] Running OCR on ${batchScenes.length} frames...`);
        const batchOCRResults = await performSceneBasedOCR(batchScenesWithFrames, uploadId, videoMetadata.duration, checkpoint, batchStart);
        logMemoryUsage(`Batch ${batchNumber} after OCR`);
        // Long videos: cleanup 720px frames per batch to save /tmp memory
        // Short videos: keep frames for Excel reuse
        if (isLongVideo) {
            console.log(`  [3/3] Cleaning up batch frames (long video mode)...`);
            await cleanupBatchFrames(batchScenesWithFrames);
        }
        // Force garbage collection hint (Node.js may or may not honor this)
        if (global.gc) {
            global.gc();
        }
        logMemoryUsage(`Batch ${batchNumber} after cleanup`);
        // Accumulate results (only text data, not images)
        allResults.push(...batchOCRResults);
        // Track batch processing time for ETA calculation
        const batchDuration = Date.now() - batchStartTime;
        batchTimes.push(batchDuration);
        const batchElapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        const avgPerScene = (parseFloat(batchElapsed) / allResults.length).toFixed(2);
        const batchDurationSec = (batchDuration / 1000).toFixed(1);
        console.log(`  ✓ Batch ${batchNumber} complete: ${allResults.length}/${scenes.length} scenes processed`);
        console.log(`    Batch time: ${batchDurationSec}s | Total: ${batchElapsed}s | Avg: ${avgPerScene}s/scene`);
    }
    // Long videos: cleanup frames directory (individual frames already cleaned per batch)
    if (isLongVideo) {
        try {
            await fsPromises.rm(framesDir, { recursive: true, force: true });
            console.log(`  🧹 Cleaned up batch frames directory`);
        }
        catch (e) {
            console.warn(`  ⚠️ Failed to cleanup frames directory: ${e}`);
        }
    }
    const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n✅ Batch Processing Complete`);
    console.log(`  📊 Processed: ${allResults.length} scenes`);
    console.log(`  ⏱️ Total time: ${totalElapsed}s`);
    console.log(`  📈 Average: ${(parseFloat(totalElapsed) / allResults.length).toFixed(2)}s/scene`);
    logMemoryUsage('After batch processing');
    return { results: allResults, framesDir: isLongVideo ? undefined : framesDir };
}
/**
 * Re-extract frames at reduced resolution for Excel embedding.
 * Used for long videos (>15 min) where 720px OCR frames were cleaned during batch processing.
 *
 * @param videoPath - Path to video file
 * @param scenes - Scenes with midTime for frame extraction
 * @param videoMetadata - Video metadata for aspect ratio
 * @param targetWidth - Target frame width in pixels (default: 320)
 * @returns Path to frames directory (caller must clean up)
 */
async function reExtractFramesForExcel(videoPath, scenes, videoMetadata, targetWidth = 320) {
    const framesDir = path.join(os.tmpdir(), `excel-frames-${Date.now()}`);
    await fsPromises.mkdir(framesDir, { recursive: true });
    const limit = pLimit(20);
    const startTime = Date.now();
    console.log(`  📸 Extracting ${scenes.length} frames at ${targetWidth}px width for Excel...`);
    await Promise.all(scenes.map((scene) => limit(async () => {
        const filename = path.join(framesDir, `scene-${scene.sceneNumber.toString().padStart(4, '0')}.png`);
        await extractFrameAtTime(videoPath, scene.midTime, filename, videoMetadata, targetWidth);
        scene.screenshotPath = filename;
    })));
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`  ⚡ Excel frame extraction: ${scenes.length} frames in ${elapsed}s`);
    return framesDir;
}
/**
 * Determine if batch processing should be used based on scene count
 * @param sceneCount - Number of scenes to process
 * @returns true if batch processing should be used
 */
function shouldUseBatchProcessing(sceneCount) {
    // Use batch processing for videos with more than 200 scenes
    // This threshold balances memory safety with processing overhead
    const BATCH_THRESHOLD = 200;
    return sceneCount > BATCH_THRESHOLD;
}
/**
 * Calculate dynamic threshold based on total scene count
 * Lower scene counts use stricter thresholds to prevent false positives
 *
 * @param totalScenes - Total number of scenes
 * @returns Threshold value (0-1)
 */
function calculateDynamicThreshold(totalScenes) {
    if (totalScenes < 20)
        return 0.8; // 80% (strict for small scene counts)
    if (totalScenes < 50)
        return 0.7; // 70%
    if (totalScenes < 100)
        return 0.6; // 60%
    return 0.5; // 50% (original threshold for large scene counts)
}
function filterPersistentOverlays(scenesWithOCR, options = {}) {
    // Use dynamic threshold if not explicitly specified
    const dynamicThreshold = calculateDynamicThreshold(scenesWithOCR.length);
    const { threshold = dynamicThreshold, minScenes = 3 } = options;
    // Early return for empty array
    if (scenesWithOCR.length === 0)
        return scenesWithOCR;
    // Skip filtering for very small scene counts (insufficient data for statistical analysis)
    if (scenesWithOCR.length < minScenes) {
        console.log(`  ⚠️ Only ${scenesWithOCR.length} scenes detected. Skipping persistent overlay filter (minimum: ${minScenes} scenes required).`);
        return scenesWithOCR;
    }
    // Log filter configuration
    console.log(`  🔧 Filter config: threshold=${(threshold * 100).toFixed(0)}%, minScenes=${minScenes}`);
    // Step 1: Split each scene's OCR text into lines
    const allLines = scenesWithOCR.map(scene => scene.ocrText
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0));
    // Step 2: Count how many scenes each unique line appears in
    const lineFrequency = new Map();
    const totalScenes = scenesWithOCR.length;
    for (const lines of allLines) {
        const uniqueLines = new Set(lines); // Count each line once per scene
        for (const line of uniqueLines) {
            lineFrequency.set(line, (lineFrequency.get(line) || 0) + 1);
        }
    }
    // Step 3: Identify persistent lines (appear in >= threshold% of scenes)
    // Use float comparison for accurate threshold calculation
    const persistentThreshold = totalScenes * threshold;
    const persistentLines = new Set();
    for (const [line, count] of lineFrequency.entries()) {
        if (count >= persistentThreshold) {
            persistentLines.add(line);
        }
    }
    // Debug: Log all unique lines and their frequencies
    console.log(`  🔍 Debug: Analyzing ${lineFrequency.size} unique lines`);
    const sortedLines = Array.from(lineFrequency.entries()).sort((a, b) => b[1] - a[1]);
    console.log(`  📊 Top 10 most frequent lines:`);
    for (const [line, count] of sortedLines.slice(0, 10)) {
        const percentage = ((count / totalScenes) * 100).toFixed(0);
        console.log(`    [${count}/${totalScenes} = ${percentage}%] "${line.substring(0, 60)}${line.length > 60 ? '...' : ''}"`);
    }
    console.log(`  ✓ Detected ${persistentLines.size} persistent overlay lines (threshold: ≥${(threshold * 100).toFixed(0)}% of ${totalScenes} scenes)`);
    if (persistentLines.size > 0) {
        console.log(`  📌 Persistent lines:`);
        for (const line of persistentLines) {
            const count = lineFrequency.get(line) || 0;
            const percentage = ((count / totalScenes) * 100).toFixed(0);
            console.log(`    - "${line.substring(0, 50)}${line.length > 50 ? '...' : ''}" (${count}/${totalScenes} = ${percentage}%)`);
        }
    }
    // Step 4: Remove persistent lines from each scene
    const filteredScenes = scenesWithOCR.map(scene => {
        const lines = scene.ocrText
            .split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0 && !persistentLines.has(line));
        const filteredText = lines.join('\n');
        return {
            ...scene,
            ocrText: filteredText
        };
    });
    const scenesWithTextBefore = scenesWithOCR.filter(s => s.ocrText.trim().length > 0).length;
    const scenesWithTextAfter = filteredScenes.filter(s => s.ocrText.trim().length > 0).length;
    console.log(`  ✓ Filtered: ${scenesWithTextBefore} → ${scenesWithTextAfter} scenes with unique text`);
    return filteredScenes;
}
/**
 * Remove consecutive duplicate OCR text with time-based consideration
 * Shows text only on first occurrence, hides on subsequent consecutive occurrences
 * BUT preserves text that displays continuously for 5+ seconds (likely important content)
 *
 * Example:
 *   Scene 1 (0-2s): "Company ABC" → Display (first occurrence)
 *   Scene 2 (2-3s): "Company ABC" → Hide (duplicate, <5s total)
 *   Scene 3 (3-7s): "Company ABC" → Display (5+ seconds total display = important)
 *   Scene 4 (7-9s): "New Product" → Display (new text)
 *   Scene 5 (9-11s): "New Product" → Hide (duplicate, <5s total)
 *
 * @param scenesWithOCR - Scenes with OCR text (after persistent overlay filtering)
 * @returns Scenes with consecutive duplicates removed
 */
function removeConsecutiveDuplicateOCR(scenesWithOCR) {
    if (scenesWithOCR.length === 0)
        return scenesWithOCR;
    console.log(`  📋 Processing ${scenesWithOCR.length} scenes for consecutive duplicate removal (time-based)`);
    let previousOCRText = ''; // Track previous scene's OCR text (normalized)
    let previousScene = null; // Track previous scene for time calculation
    let duplicateStartTime = 0; // Track when current duplicate sequence started
    let duplicateCount = 0;
    let firstOccurrences = 0;
    let preservedLongDuplicates = 0; // Track duplicates preserved due to 5+ second rule
    const duplicateRanges = []; // Track duplicate ranges for logging
    const LONG_DISPLAY_THRESHOLD = 5.0; // 5 seconds threshold
    const processedScenes = scenesWithOCR.map((scene, index) => {
        // Normalize OCR text for comparison (trim, remove extra whitespace)
        const currentOCRText = scene.ocrText
            .trim()
            .split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0)
            .join('\n');
        // Check if current text is same as previous (consecutive duplicate)
        if (currentOCRText.length > 0 && currentOCRText === previousOCRText && previousScene) {
            // Calculate total display duration from first occurrence to current scene end
            const totalDisplayDuration = scene.endTime - duplicateStartTime;
            // If text has been displayed for 5+ seconds, preserve it (likely important)
            if (totalDisplayDuration >= LONG_DISPLAY_THRESHOLD) {
                preservedLongDuplicates++;
                console.log(`  ⏰ Scene ${scene.sceneNumber}: Preserving duplicate (${totalDisplayDuration.toFixed(1)}s >= ${LONG_DISPLAY_THRESHOLD}s)`);
                return scene; // Keep the text
            }
            // Otherwise, hide duplicate occurrence
            duplicateCount++;
            // Track duplicate range
            if (duplicateRanges.length === 0 || !duplicateRanges[duplicateRanges.length - 1].includes(`~${scene.sceneNumber}`)) {
                if (duplicateRanges.length > 0 && duplicateRanges[duplicateRanges.length - 1].endsWith(`${scene.sceneNumber - 1}`)) {
                    // Extend existing range
                    duplicateRanges[duplicateRanges.length - 1] = duplicateRanges[duplicateRanges.length - 1].replace(`~${scene.sceneNumber - 1}`, `~${scene.sceneNumber}`);
                }
                else {
                    // Start new range
                    duplicateRanges.push(`Scene ${scene.sceneNumber - 1}~${scene.sceneNumber}`);
                }
            }
            previousScene = scene; // Update previous scene for next iteration
            return {
                ...scene,
                ocrText: '' // Hide duplicate by setting to empty string
            };
        }
        else {
            // New text or empty text - keep it
            if (currentOCRText.length > 0) {
                firstOccurrences++;
                previousOCRText = currentOCRText; // Update previous text
                duplicateStartTime = scene.startTime; // Track start time of this new text
            }
            else {
                // Empty text - reset tracking (don't carry over to next scene)
                previousOCRText = '';
                duplicateStartTime = 0;
            }
            previousScene = scene; // Update previous scene
            return scene;
        }
    });
    // Log statistics
    console.log(`  ✓ Consecutive duplicate removal complete (time-based):`);
    console.log(`     - First occurrences (displayed): ${firstOccurrences}`);
    console.log(`     - Duplicates removed (hidden): ${duplicateCount}`);
    console.log(`     - Long duplicates preserved (5+s): ${preservedLongDuplicates}`);
    if (duplicateRanges.length > 0) {
        const samplesToShow = Math.min(5, duplicateRanges.length);
        console.log(`     - Duplicate ranges (first ${samplesToShow}):`);
        for (let i = 0; i < samplesToShow; i++) {
            console.log(`       • ${duplicateRanges[i]}`);
        }
        if (duplicateRanges.length > samplesToShow) {
            console.log(`       ... and ${duplicateRanges.length - samplesToShow} more`);
        }
    }
    const removalRate = scenesWithOCR.length > 0
        ? ((duplicateCount / scenesWithOCR.length) * 100).toFixed(1)
        : '0.0';
    console.log(`     - Removal rate: ${removalRate}% (${duplicateCount}/${scenesWithOCR.length} scenes)`);
    return processedScenes;
}
/**
 * Map transcription segments to scenes based on timestamps
 * Uses midpoint-based assignment to prevent duplicate narration across scenes
 */
function mapTranscriptionToScenes(scenesWithOCR, transcription) {
    // Track segment usage for duplicate detection
    const segmentUsage = new Map();
    const result = scenesWithOCR.map(scene => {
        // Find all transcription segments whose midpoint falls within this scene
        // This prevents the same narration from appearing in multiple scenes
        const overlappingSegments = transcription.filter(seg => {
            const segMidpoint = seg.timestamp + seg.duration / 2;
            const sceneStart = scene.startTime;
            const sceneEnd = scene.endTime;
            // Assign segment to scene if midpoint is within scene boundaries
            return segMidpoint >= sceneStart && segMidpoint < sceneEnd;
        });
        // Track usage for duplicate detection
        overlappingSegments.forEach(seg => {
            const segKey = `${seg.timestamp.toFixed(2)}-${seg.text.substring(0, 30)}`;
            if (!segmentUsage.has(segKey)) {
                segmentUsage.set(segKey, []);
            }
            segmentUsage.get(segKey).push(scene.sceneNumber);
        });
        // Concatenate all overlapping transcription text
        const narrationText = overlappingSegments
            .map(seg => seg.text.trim())
            .filter(text => text.length > 0)
            .join(' ');
        return {
            ...scene,
            narrationText
        };
    });
    // Report duplicate usage (should be zero with midpoint-based assignment)
    let duplicateCount = 0;
    segmentUsage.forEach((sceneNumbers, segKey) => {
        if (sceneNumbers.length > 1) {
            duplicateCount++;
            if (duplicateCount <= 3) { // Show first 3 duplicates only
                console.warn(`[Narration] ⚠️ Duplicate detected in scenes ${sceneNumbers.join(', ')}: "${segKey}"`);
            }
        }
    });
    if (duplicateCount > 0) {
        console.warn(`[Narration] ⚠️ Total ${duplicateCount} narration segments appear in multiple scenes (unexpected with midpoint-based assignment)`);
    }
    else {
        console.log(`[Narration] ✓ No duplicate narration detected (midpoint-based assignment working correctly)`);
    }
    // Log narration coverage statistics
    const scenesWithNarration = result.filter(s => s.narrationText && s.narrationText.trim().length > 0).length;
    const narrationCoverage = ((scenesWithNarration / result.length) * 100).toFixed(1);
    console.log(`[Narration] ✓ Narration coverage: ${scenesWithNarration}/${result.length} scenes (${narrationCoverage}%)`);
    return result;
}
/**
 * Convert scenes to Excel rows
 */
function convertScenesToExcelRows(scenes) {
    return scenes.map(scene => ({
        sceneNumber: scene.sceneNumber,
        timecode: scene.timecode,
        screenshotPath: scene.screenshotPath,
        ocrText: scene.ocrText || '',
        narrationText: scene.narrationText || ''
    }));
}
//# sourceMappingURL=pipeline.js.map