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

import {
  extractScenesWithFrames,
  getVideoMetadata,
  cleanupFrames,
  transcodeToProcessingResolution,
  splitVideoWithOverlap,
  cleanupChunks,
  extractFrameAtTime,
  VideoChunk,
  // Batch processing functions (memory optimization)
  detectScenesOnly,
  extractFramesForBatch,
  cleanupBatchFrames,
  logMemoryUsage,
  DEFAULT_BATCH_SIZE,
  // Progress tracking
  SceneDetectionProgressCallback,
} from './ffmpeg.js';
import { generateExcel, generateExcelFilename } from './excel-generator.js';
import { Scene, ExcelRow, VideoMetadata, ProcessingStats } from '../types/excel.js';
import { formatTimecode } from '../utils/timecode.js';
import fs from 'fs';
import { promises as fsPromises } from 'fs';
import path from 'path';
import os from 'os';
import type { TranscriptionSegment, DetectionMode, SceneCut } from '../types/shared.js';
import pLimit from 'p-limit';
import { ProgressReporter } from './progressReporter.js';
import { getOCRRouter, ImageTask } from './ocrRouter.js';
import { runLuminanceDetection, StabilizationPoint } from './luminanceDetector.js';
import { processStabilizationPoints, StableTextResult } from './textStabilityDetector.js';
import { updateStatus, updatePhaseProgress, completePhase } from './statusManager.js';
import {
  detectWithTransNetAndFallback,
  isTransNetEnabled,
  validateTransNetInstallation,
} from './transnetDetector.js';
import {
  detectSupplementarySections,
  mergeWithTransNetCuts,
} from './supplementaryDetector.js';
import { sendTransNetFailureAlert } from './alertService.js';
import {
  saveCheckpoint,
  setSceneCuts,
  addCompletedOcrScenes,
  OCR_CHECKPOINT_INTERVAL,
  type ProcessingCheckpoint,
} from './checkpointService.js';
import { registerOcrProgress, clearOcrProgress } from './emergencyCheckpoint.js';

/**
 * Main pipeline execution
 * @param videoPath - Path to video file
 * @param projectTitle - Project/video title
 * @param transcription - Transcription from whisperService
 * @param uploadId - Optional upload ID for progress tracking
 * @param detectionMode - Detection mode ('standard' or 'enhanced')
 * @param checkpoint - Optional checkpoint for resumable processing
 * @returns Path to generated Excel file
 */
export async function executeIdealPipeline(
  videoPath: string,
  projectTitle: string,
  transcription: TranscriptionSegment[],
  uploadId?: string,
  detectionMode: DetectionMode = 'standard',
  checkpoint?: ProcessingCheckpoint,
  preDetectedScenes?: Scene[]
): Promise<{ excelPath: string; stats: ProcessingStats }> {
  console.log('🎬 Starting Ideal Pipeline Execution');
  console.log(`  📹 Video: ${videoPath}`);
  console.log(`  🎙️ Transcription: ${transcription.length} segments`);
  console.log(`  🎯 Detection Mode: ${detectionMode}`);

  // Helper function for safe phase progress updates
  const safePhaseProgress = async (
    phase: 2 | 3,
    phaseProgress: number,
    subTask: string,
    stage: string,
    estimatedTime?: string
  ) => {
    if (!uploadId) return;
    try {
      await updatePhaseProgress(uploadId, phase, phaseProgress, {
        subTask,
        stage: stage as any,
        estimatedTimeRemaining: estimatedTime,
      });
    } catch (err) {
      console.warn(`Failed to update phase progress: ${err}`);
    }
  };

  // Phase 2 Step 1: Extract video metadata
  // Phase 2 progress: 0-5%
  await safePhaseProgress(2, 0, 'Reading video metadata...', 'scene_detection');
  console.log('\n📐 Step 1: Extracting video metadata...');
  const videoMetadata = await getVideoMetadata(videoPath);
  await safePhaseProgress(2, 5, 'Starting scene detection...', 'scene_detection', 'About 2-5 min (estimate)');

  // Phase 2 Step 2: Scene detection
  // Phase 2 progress: 5-25%
  // Check if scenes are already available from parallel processing, checkpoint, or need detection
  let scenes: Scene[] = [];
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
        const sceneCuts: SceneCut[] = scenes.map(scene => ({
          timestamp: scene.startTime,
          confidence: 0.95,
          source: 'ffmpeg_standard' as const,
        }));
        await setSceneCuts(uploadId, sceneCuts);
        console.log(`  💾 Saved ${sceneCuts.length} pre-detected scene cuts to checkpoint`);
      } catch (err) {
        console.warn(`  ⚠️ Failed to save scene cuts checkpoint: ${err}`);
      }
    }

    await safePhaseProgress(2, 25, `${scenes.length} scenes (pre-detected)`, 'frame_extraction');
  } else if (isSceneDetectionComplete) {
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
      } as Scene;
    });

    await safePhaseProgress(2, 25, `${scenes.length} scenes loaded from checkpoint`, 'frame_extraction');
  } else {
    // First, detect scenes only (no frame extraction) for memory optimization
    console.log('\n🎞️ Step 2: Scene detection...');
    await safePhaseProgress(2, 10, 'Detecting scenes ...', 'scene_detection');

    // Progress callback for scene detection (updates UI with current position)
    const sceneDetectionProgress: SceneDetectionProgressCallback = async (
      currentTime,
      totalDuration,
      formattedProgress
    ) => {
      // Calculate progress: 10-25% is scene detection phase
      const progressPercent = Math.min(24, 10 + Math.floor((currentTime / totalDuration) * 14));
      await safePhaseProgress(
        2,
        progressPercent,
        `Detecting scenes: ${formattedProgress}`,
        'scene_detection'
      );
    };

    // Detect scenes without extracting frames (batch processing optimization)
    const { scenes: detectedScenes } = await detectScenesOnly(
      videoPath,
      videoMetadata,
      sceneDetectionProgress
    );
    scenes = detectedScenes;
    console.log(`  ✓ Detected ${scenes.length} scenes`);

    // Save scene cuts to checkpoint
    if (uploadId && checkpoint) {
      try {
        const sceneCuts: SceneCut[] = scenes.map(scene => ({
          timestamp: scene.startTime,
          confidence: 0.95,
          source: 'ffmpeg_standard' as const,
        }));
        await setSceneCuts(uploadId, sceneCuts);
        console.log(`  💾 Saved ${sceneCuts.length} scene cuts to checkpoint`);
      } catch (err) {
        console.warn(`  ⚠️ Failed to save scene cuts checkpoint: ${err}`);
      }
    }
  }

  // Determine if batch processing is needed (for memory optimization)
  const useBatchProcessing = shouldUseBatchProcessing(scenes.length);
  if (useBatchProcessing) {
    console.log(`  📦 Batch processing ENABLED (${scenes.length} scenes > threshold)`);
    logMemoryUsage('Before batch decision');
  } else {
    // For smaller videos, extract frames immediately (traditional approach)
    console.log(`  ⚡ Traditional processing (${scenes.length} scenes - fast path)`);
    const framesDir = path.join(os.tmpdir(), `frames-${Date.now()}`);
    scenes = await extractFramesForBatch(videoPath, scenes, framesDir, videoMetadata);
  }

  await safePhaseProgress(2, 25, `${scenes.length} scenes detected`, 'frame_extraction');

  // Enhanced mode statistics
  let luminanceTransitionsDetected = 0;
  let textStabilizationPoints = 0;
  let transnetCutsCount = 0;
  let supplementaryCutsCount = 0;
  let fallbackUsed = false;

  // Enhanced mode: TransNet V2 + Supplementary detection
  if (detectionMode === 'enhanced') {
    console.log('\n🚀 Step 2.5: Enhanced Mode V2 - TransNet V2 + Supplementary Detection...');

    // Check if TransNet V2 is enabled and available
    const transnetEnabled = isTransNetEnabled();
    console.log(`  TransNet V2 enabled: ${transnetEnabled}`);

    if (transnetEnabled) {
      // Validate TransNet installation
      const validation = await validateTransNetInstallation();
      console.log(`  TransNet V2 validation: ${validation.valid ? '✓ Available' : '✗ Not available'}`);

      if (validation.valid) {
        // Phase 2 enhanced mode progress: 25-30%
        await safePhaseProgress(2, 28, 'TransNet V2: Processing video...', 'scene_detection');

        try {
          // Step 2.5a: Transcode to 720p for faster processing
          console.log('\n  📹 Step 2.5a: Transcoding to 720p for processing...');
          const processingVideoPath = path.join(os.tmpdir(), `transnet_720p_${Date.now()}.mp4`);
          await transcodeToProcessingResolution(videoPath, processingVideoPath, 720);
          console.log(`  ✓ Transcoded to 720p: ${processingVideoPath}`);

          // Step 2.5b: Split video into chunks for parallel processing
          console.log('\n  📦 Step 2.5b: Splitting video into chunks...');
          const chunksDir = fs.mkdtempSync(path.join(os.tmpdir(), 'transnet-chunks-'));
          const chunks = await splitVideoWithOverlap(processingVideoPath, chunksDir, 60, 10);
          console.log(`  ✓ Split into ${chunks.length} chunks (60s each, 10s overlap)`);

          // Phase 2 progress: 30%
          await safePhaseProgress(2, 30, `TransNet V2: Processing ${chunks.length} chunks...`, 'scene_detection');

          // Step 2.5c: Run TransNet V2 with fallback
          console.log('\n  🧠 Step 2.5c: Running TransNet V2 detection...');
          const transnetResult = await detectWithTransNetAndFallback(
            processingVideoPath,
            chunks,
            // FFmpeg fallback function
            async (fallbackPath: string) => {
              console.log('  🔄 Falling back to FFmpeg detection...');
              const ffmpegScenes = await extractScenesWithFrames(fallbackPath);
              return ffmpegScenes.map(scene => ({
                timestamp: scene.startTime,
                confidence: 0.8,
                source: 'ffmpeg_enhanced' as const,
              }));
            },
            // Fallback callback for developer notification
            async (error: string) => {
              console.warn(`  ⚠️ TransNet V2 failed, sending alert: ${error}`);
              await sendTransNetFailureAlert(error, {
                uploadId,
                fileName: projectTitle,
                stage: 'transnet_detection',
                error,
              });
            }
          );

          transnetCutsCount = transnetResult.cuts.length;
          fallbackUsed = transnetResult.fallbackUsed;
          console.log(`  ✓ TransNet detection: ${transnetCutsCount} cuts (fallback: ${fallbackUsed})`);

          // Step 2.5d: Run supplementary detection
          console.log('\n  🔍 Step 2.5d: Running supplementary detection...');
          // Phase 2 progress: 35%
          await safePhaseProgress(2, 35, 'Supplementary detection: Analyzing...', 'scene_detection');

          const supplementaryResult = await detectSupplementarySections(processingVideoPath);
          supplementaryCutsCount = supplementaryResult.cuts.length;
          luminanceTransitionsDetected = supplementaryResult.luminanceSections.length;
          console.log(`  ✓ Supplementary detection: ${supplementaryCutsCount} cuts`);
          console.log(`    - Luminance sections: ${supplementaryResult.luminanceSections.length}`);
          console.log(`    - Motion sections: ${supplementaryResult.motionSections.length}`);

          // Step 2.5e: Merge all cuts
          console.log('\n  🔀 Step 2.5e: Merging detection results...');
          const allCuts = mergeWithTransNetCuts(transnetResult.cuts, supplementaryResult.cuts, 0.5);
          console.log(`  ✓ Total merged cuts: ${allCuts.length}`);

          // Step 2.5f: Convert cuts to scenes (extract frames from ORIGINAL video)
          console.log('\n  🎬 Step 2.5f: Converting cuts to scenes with original resolution frames...');
          const enhancedScenes = await convertCutsToScenes(
            allCuts,
            videoPath, // Use original video for high-quality screenshots
            videoMetadata.duration
          );

          // Merge with standard detection or replace
          if (enhancedScenes.length > 0) {
            scenes = enhancedScenes;
            console.log(`  ✓ Enhanced mode produced ${scenes.length} scenes`);
          }

          // Cleanup temporary files
          console.log('\n  🧹 Cleaning up temporary files...');
          await cleanupChunks(chunks);
          await fsPromises.unlink(processingVideoPath).catch(() => {});
          await fsPromises.rm(chunksDir, { recursive: true, force: true }).catch(() => {});
          console.log('  ✓ Cleanup complete');

        } catch (transnetError) {
          // TransNet mode errors are non-fatal - continue with standard detection
          console.warn('\n⚠️ TransNet V2 enhanced mode failed, continuing with standard results:');
          console.warn(`  Error: ${transnetError instanceof Error ? transnetError.message : String(transnetError)}`);

          // Send failure alert
          await sendTransNetFailureAlert(
            transnetError instanceof Error ? transnetError.message : String(transnetError),
            { uploadId, fileName: projectTitle, stage: 'transnet_pipeline' }
          ).catch(e => console.warn('Failed to send alert:', e));
        }
      } else {
        console.warn(`  ⚠️ TransNet V2 not available: ${validation.error}`);
        console.log('  Falling back to legacy enhanced mode...');
        // Fall through to legacy enhanced mode
      }
    }

    // Legacy enhanced mode (if TransNet is not enabled or not available)
    if (!transnetEnabled || transnetCutsCount === 0) {
      console.log('\n🔦 Step 2.5 (Legacy): Luminance-based detection...');

      // Phase 2 progress: 28%
      await safePhaseProgress(2, 28, 'Luminance-based detection: Analyzing...', 'scene_detection');

      try {
        // Step 2.5a: Run luminance detection
        const luminanceResults = await runLuminanceDetection(videoPath);
        luminanceTransitionsDetected = luminanceResults.stabilizationPoints.length;

        console.log(`  ✓ Found ${luminanceResults.whiteIntervals.length} white screen intervals`);
        console.log(`  ✓ Found ${luminanceResults.blackIntervals.length} black screen intervals`);
        console.log(`  ✓ Found ${luminanceTransitionsDetected} stabilization points`);

        // Step 2.5b: Process text stabilization if stabilization points were found
        if (luminanceResults.stabilizationPoints.length > 0) {
          // Phase 2 progress: 35%
          await safePhaseProgress(2, 35, 'Processing text stabilization points...', 'scene_detection');

          // Create temporary directory for stabilization frames
          const stabTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stab-frames-'));

          try {
            const textResults = await processStabilizationPoints(
              videoPath,
              luminanceResults.stabilizationPoints,
              stabTempDir
            );

            textStabilizationPoints = textResults.length;
            console.log(`  ✓ Found ${textStabilizationPoints} text stabilization points`);

            // Step 2.5c: Merge text stabilization results with existing scenes
            if (textResults.length > 0) {
              scenes = mergeEnhancedDetectionResults(scenes, textResults);
              console.log(`  ✓ Merged enhanced detection: ${scenes.length} total scenes`);
            }
          } finally {
            // Cleanup temporary frames
            try {
              fs.rmSync(stabTempDir, { recursive: true, force: true });
            } catch (e) {
              console.warn('  ⚠️ Failed to cleanup stabilization frames:', e);
            }
          }
        }

      } catch (enhancedError) {
        // Enhanced mode errors are non-fatal - continue with standard detection
        console.warn('\n⚠️ Enhanced mode detection failed, continuing with standard results:');
        console.warn(`  Error: ${enhancedError instanceof Error ? enhancedError.message : String(enhancedError)}`);
      }
    }
  }

  // Phase 2 Step 3: Perform OCR on each scene frame
  // Phase 2 progress: 25-90% (batch processing) or 40-90% (traditional)
  let scenesWithRawOCR: SceneWithOCR[];

  if (useBatchProcessing) {
    // Batch processing: extract frames → OCR → cleanup in batches
    // This keeps peak memory under control for long videos
    console.log('\n🔍 Step 3: Batch Processing (Frame Extraction + OCR + Cleanup)...');
    await safePhaseProgress(2, 25, `Starting batch processing on ${scenes.length} scenes...`, 'batch_processing', 'Processing in batches for memory optimization');
    scenesWithRawOCR = await processScenesInBatches(
      videoPath,
      scenes,
      videoMetadata,
      uploadId,
      DEFAULT_BATCH_SIZE,
      checkpoint
    );
  } else {
    // Traditional processing: OCR on already-extracted frames
    await safePhaseProgress(2, 40, `Starting OCR on ${scenes.length} scenes...`, 'ocr_processing', 'About 2-5 min (estimate)');
    console.log('\n🔍 Step 3: Performing OCR on scene frames...');
    scenesWithRawOCR = await performSceneBasedOCR(scenes, uploadId, videoMetadata.duration, checkpoint);
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
    } catch (err) {
      console.warn(`Failed to complete Phase 2: ${err}`);
    }
  }

  // Phase 3 Step 1: Map transcription to scenes
  // Phase 3 progress: 0-30%
  await safePhaseProgress(3, 0, 'Mapping narration to scenes...', 'narration_mapping');
  console.log('\n🎙️ Step 4: Mapping transcription to scenes...');
  const scenesWithNarration = mapTranscriptionToScenes(scenesWithOCR, transcription);
  await safePhaseProgress(3, 30, 'Narration mapping complete', 'narration_mapping');

  // Step 5: Convert to Excel rows
  console.log('\n📝 Step 5: Converting to Excel rows...');
  const excelRows = convertScenesToExcelRows(scenesWithNarration);

  // Phase 3 Step 2: Generate Excel file
  // Phase 3 progress: 30-70%
  await safePhaseProgress(3, 30, 'Generating Excel file...', 'excel_generation');
  console.log('\n📊 Step 6: Generating Excel file...');
  const excelFilename = generateExcelFilename(projectTitle);
  const excelPath = path.join('/tmp', excelFilename);

  await safePhaseProgress(3, 40, 'Creating workbook...', 'excel_generation');
  const excelBuffer = await generateExcel({
    projectTitle,
    rows: excelRows,
    videoMetadata,
    includeStatistics: true
  });

  // Write Excel buffer to file
  await safePhaseProgress(3, 60, 'Writing Excel file...', 'excel_generation');
  await fsPromises.writeFile(excelPath, excelBuffer);
  await safePhaseProgress(3, 70, 'Excel file created', 'excel_generation');

  // Step 7: Calculate statistics
  const stats: ProcessingStats & { luminanceTransitionsDetected?: number; textStabilizationPoints?: number } = {
    totalScenes: scenes.length,
    scenesWithOCRText: excelRows.filter(r => r.ocrText && r.ocrText.trim().length > 0).length,
    scenesWithNarration: excelRows.filter(r => r.narrationText && r.narrationText.trim().length > 0).length,
    processingTimeMs: 0, // Set by caller
    videoMetadata,
    // Enhanced mode statistics (only populated if detectionMode === 'enhanced')
    luminanceTransitionsDetected: detectionMode === 'enhanced' ? luminanceTransitionsDetected : undefined,
    textStabilizationPoints: detectionMode === 'enhanced' ? textStabilizationPoints : undefined
  };

  console.log('\n✅ Ideal Pipeline Execution Complete');
  console.log(`  📊 Excel file: ${excelPath}`);
  console.log(`  📈 Statistics:`, stats);

  // Cleanup frames (only for traditional processing - batch processing cleans up automatically)
  if (!useBatchProcessing) {
    await cleanupFrames(scenes);
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
async function performSceneBasedOCR(
  scenes: Scene[],
  uploadId?: string,
  videoDuration?: number,
  checkpoint?: ProcessingCheckpoint
): Promise<SceneWithOCR[]> {
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
  const tasks: ImageTask[] = [];
  const sceneIndices: number[] = [];

  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];

    // Skip scenes that already have cached OCR results
    if (completedOcrScenes.has(i)) {
      continue; // Will be populated from cache later
    }

    if (scene.screenshotPath) {
      try {
        const imageBuffer = fs.readFileSync(scene.screenshotPath);
        tasks.push({
          id: scene.sceneNumber,
          imageBuffer,
          metadata: { sceneIndex: i },
        });
        sceneIndices.push(i);
      } catch (err) {
        console.warn(`  ⚠️ Scene ${scene.sceneNumber}: Failed to read screenshot: ${err}`);
      }
    } else {
      console.log(`  ⚠️ Scene ${scene.sceneNumber}: No screenshot, skipping OCR`);
    }
  }

  const cachedCount = completedOcrScenes.size;
  console.log(`  📸 Loaded ${tasks.length}/${scenes.length} screenshots for OCR (${cachedCount} cached)`);

  // If all scenes are cached, skip OCR processing
  if (tasks.length === 0 && cachedCount > 0) {
    console.log(`  ✓ All OCR results loaded from cache`);
    const scenesWithOCR: SceneWithOCR[] = scenes.map((scene, i) => ({
      ...scene,
      ocrText: cachedOcrResults[i] || '',
      ocrConfidence: cachedOcrResults[i] ? 0.95 : 0,
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
    } catch (err) {
      console.warn(`Failed to update OCR progress: ${err}`);
    }
  }

  // Process all images in parallel using OCR router
  const batchResult = await ocrRouter.processParallel(tasks);

  // Map results back to scenes (initialize with cached results)
  const scenesWithOCR: SceneWithOCR[] = scenes.map((scene, i) => ({
    ...scene,
    ocrText: cachedOcrResults[i] || '',
    ocrConfidence: cachedOcrResults[i] ? 0.95 : 0,
  }));

  // Populate OCR results from new processing
  const newOcrResults: Record<number, string> = {};
  const newCompletedScenes: number[] = [];
  let lastSavedIndex = -1;  // Track last checkpoint-saved index for emergency save

  for (let i = 0; i < batchResult.results.length; i++) {
    const result = batchResult.results[i];
    const sceneIndex = sceneIndices[i];
    if (sceneIndex !== undefined) {
      scenesWithOCR[sceneIndex].ocrText = result.text;
      scenesWithOCR[sceneIndex].ocrConfidence = result.confidence;

      // Track for checkpoint
      newOcrResults[sceneIndex] = result.text;
      newCompletedScenes.push(sceneIndex);

      // Register progress for emergency save on SIGTERM
      if (uploadId) {
        registerOcrProgress(uploadId, newCompletedScenes, newOcrResults, lastSavedIndex);
      }

      // Log result
      const scene = scenesWithOCR[sceneIndex];
      const textPreview =
        result.text.length > 0
          ? result.text.substring(0, 50).replace(/\n/g, ' ')
          : '(no text)';

      console.log(
        `  ✓ Scene ${scene.sceneNumber}: OCR complete ` +
          `(text: ${result.text.length} chars, confidence: ${result.confidence.toFixed(2)}, provider: ${result.provider})`
      );

      if (result.text.length > 0) {
        console.log(`    Preview: "${textPreview}${result.text.length > 50 ? '...' : ''}"`);
      }

      // Save checkpoint every OCR_CHECKPOINT_INTERVAL scenes
      if (uploadId && checkpoint && newCompletedScenes.length > 0 && newCompletedScenes.length % OCR_CHECKPOINT_INTERVAL === 0) {
        try {
          await addCompletedOcrScenes(uploadId, newCompletedScenes, newOcrResults);
          lastSavedIndex = Math.max(...newCompletedScenes);  // Update last saved index
          console.log(`  💾 OCR Checkpoint saved: ${completedOcrScenes.size + newCompletedScenes.length}/${scenes.length} scenes`);
        } catch (err) {
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
    } catch (err) {
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
    } catch (err) {
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
async function processScenesInBatches(
  videoPath: string,
  scenes: Scene[],
  videoMetadata: VideoMetadata,
  uploadId?: string,
  batchSize: number = DEFAULT_BATCH_SIZE,
  checkpoint?: ProcessingCheckpoint
): Promise<SceneWithOCR[]> {
  console.log('\n📦 Starting Batch Processing (Memory Optimized)');
  console.log(`  📊 Total scenes: ${scenes.length}`);
  console.log(`  📦 Batch size: ${batchSize}`);
  console.log(`  🔢 Total batches: ${Math.ceil(scenes.length / batchSize)}`);

  logMemoryUsage('Before batch processing');

  const allResults: SceneWithOCR[] = [];
  const framesDir = path.join(os.tmpdir(), `batch-frames-${Date.now()}`);

  // Create frames directory
  await fsPromises.mkdir(framesDir, { recursive: true });

  const totalBatches = Math.ceil(scenes.length / batchSize);
  const startTime = Date.now();

  // Track batch timing for ETA calculation
  let batchTimes: number[] = [];

  // Helper for safe progress updates with ETA
  const safePhaseProgress = async (
    phaseProgress: number,
    subTask: string,
    estimatedTimeRemaining?: string
  ) => {
    if (!uploadId) return;
    try {
      await updatePhaseProgress(uploadId, 2, phaseProgress, {
        subTask,
        stage: 'batch_processing',
        estimatedTimeRemaining,
      });
    } catch (err) {
      console.warn(`Failed to update batch progress: ${err}`);
    }
  };

  // Format remaining time for display
  const formatTimeRemaining = (seconds: number): string => {
    if (seconds < 60) {
      return `About ${Math.ceil(seconds)} seconds remaining`;
    } else if (seconds < 3600) {
      const minutes = Math.ceil(seconds / 60);
      return `About ${minutes} minute${minutes > 1 ? 's' : ''} remaining`;
    } else {
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
    let estimatedTimeRemaining: string | undefined;
    if (batchTimes.length > 0) {
      const avgBatchTime = batchTimes.reduce((a, b) => a + b, 0) / batchTimes.length;
      const remainingBatches = totalBatches - batchIndex;
      const remainingSeconds = (avgBatchTime / 1000) * remainingBatches;
      estimatedTimeRemaining = formatTimeRemaining(remainingSeconds);
    } else if (batchIndex === 0) {
      // First batch: provide rough estimate based on typical processing time
      // ~0.5 seconds per scene is a reasonable estimate
      const roughEstimate = scenes.length * 0.5;
      estimatedTimeRemaining = formatTimeRemaining(roughEstimate);
    }

    await safePhaseProgress(
      batchProgress,
      `Batch ${batchNumber}/${totalBatches}: Processing ${batchScenes.length} scenes...`,
      estimatedTimeRemaining
    );

    // Step 1: Extract frames for this batch
    console.log(`  [1/3] Extracting ${batchScenes.length} frames...`);
    const batchScenesWithFrames = await extractFramesForBatch(
      videoPath,
      batchScenes,
      framesDir,
      videoMetadata
    );

    logMemoryUsage(`Batch ${batchNumber} after frame extraction`);

    // Step 2: Run OCR for this batch (pass video duration for long video optimization)
    console.log(`  [2/3] Running OCR on ${batchScenes.length} frames...`);
    const batchOCRResults = await performSceneBasedOCR(batchScenesWithFrames, uploadId, videoMetadata.duration, checkpoint);

    logMemoryUsage(`Batch ${batchNumber} after OCR`);

    // Step 3: Cleanup frames immediately to free memory
    console.log(`  [3/3] Cleaning up batch frames...`);
    await cleanupBatchFrames(batchScenesWithFrames);

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

  // Cleanup frames directory
  try {
    await fsPromises.rm(framesDir, { recursive: true, force: true });
    console.log(`  🧹 Cleaned up batch frames directory`);
  } catch (e) {
    console.warn(`  ⚠️ Failed to cleanup frames directory: ${e}`);
  }

  const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n✅ Batch Processing Complete`);
  console.log(`  📊 Processed: ${allResults.length} scenes`);
  console.log(`  ⏱️ Total time: ${totalElapsed}s`);
  console.log(`  📈 Average: ${(parseFloat(totalElapsed) / allResults.length).toFixed(2)}s/scene`);
  logMemoryUsage('After batch processing');

  return allResults;
}

/**
 * Determine if batch processing should be used based on scene count
 * @param sceneCount - Number of scenes to process
 * @returns true if batch processing should be used
 */
function shouldUseBatchProcessing(sceneCount: number): boolean {
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
function calculateDynamicThreshold(totalScenes: number): number {
  if (totalScenes < 20) return 0.8; // 80% (strict for small scene counts)
  if (totalScenes < 50) return 0.7; // 70%
  if (totalScenes < 100) return 0.6; // 60%
  return 0.5; // 50% (original threshold for large scene counts)
}

/**
 * Filter out persistent overlays (logos, watermarks, constant UI elements)
 * Removes text that appears in threshold% or more of scenes (dynamic threshold based on total scenes)
 *
 * @param scenesWithOCR - Scenes with OCR text
 * @param options - Filter options (threshold, minScenes)
 * @returns Filtered scenes
 */
interface OverlayFilterOptions {
  threshold?: number; // Default: dynamic based on scene count
  minScenes?: number; // Default: 3 (minimum scenes to apply filter)
}

function filterPersistentOverlays(
  scenesWithOCR: SceneWithOCR[],
  options: OverlayFilterOptions = {}
): SceneWithOCR[] {
  // Use dynamic threshold if not explicitly specified
  const dynamicThreshold = calculateDynamicThreshold(scenesWithOCR.length);
  const { threshold = dynamicThreshold, minScenes = 3 } = options;

  // Early return for empty array
  if (scenesWithOCR.length === 0) return scenesWithOCR;

  // Skip filtering for very small scene counts (insufficient data for statistical analysis)
  if (scenesWithOCR.length < minScenes) {
    console.log(`  ⚠️ Only ${scenesWithOCR.length} scenes detected. Skipping persistent overlay filter (minimum: ${minScenes} scenes required).`);
    return scenesWithOCR;
  }

  // Log filter configuration
  console.log(`  🔧 Filter config: threshold=${(threshold * 100).toFixed(0)}%, minScenes=${minScenes}`);

  // Step 1: Split each scene's OCR text into lines
  const allLines: string[][] = scenesWithOCR.map(scene =>
    scene.ocrText
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
  );

  // Step 2: Count how many scenes each unique line appears in
  const lineFrequency = new Map<string, number>();
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
  const persistentLines = new Set<string>();

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
function removeConsecutiveDuplicateOCR(scenesWithOCR: SceneWithOCR[]): SceneWithOCR[] {
  if (scenesWithOCR.length === 0) return scenesWithOCR;

  console.log(`  📋 Processing ${scenesWithOCR.length} scenes for consecutive duplicate removal (time-based)`);

  let previousOCRText = '';  // Track previous scene's OCR text (normalized)
  let previousScene: SceneWithOCR | null = null;  // Track previous scene for time calculation
  let duplicateStartTime = 0;  // Track when current duplicate sequence started
  let duplicateCount = 0;
  let firstOccurrences = 0;
  let preservedLongDuplicates = 0;  // Track duplicates preserved due to 5+ second rule
  const duplicateRanges: string[] = [];  // Track duplicate ranges for logging
  const LONG_DISPLAY_THRESHOLD = 5.0;  // 5 seconds threshold

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
        return scene;  // Keep the text
      }

      // Otherwise, hide duplicate occurrence
      duplicateCount++;

      // Track duplicate range
      if (duplicateRanges.length === 0 || !duplicateRanges[duplicateRanges.length - 1].includes(`~${scene.sceneNumber}`)) {
        if (duplicateRanges.length > 0 && duplicateRanges[duplicateRanges.length - 1].endsWith(`${scene.sceneNumber - 1}`)) {
          // Extend existing range
          duplicateRanges[duplicateRanges.length - 1] = duplicateRanges[duplicateRanges.length - 1].replace(
            `~${scene.sceneNumber - 1}`,
            `~${scene.sceneNumber}`
          );
        } else {
          // Start new range
          duplicateRanges.push(`Scene ${scene.sceneNumber - 1}~${scene.sceneNumber}`);
        }
      }

      previousScene = scene;  // Update previous scene for next iteration
      return {
        ...scene,
        ocrText: ''  // Hide duplicate by setting to empty string
      };
    } else {
      // New text or empty text - keep it
      if (currentOCRText.length > 0) {
        firstOccurrences++;
        previousOCRText = currentOCRText;  // Update previous text
        duplicateStartTime = scene.startTime;  // Track start time of this new text
      } else {
        // Empty text - reset tracking (don't carry over to next scene)
        previousOCRText = '';
        duplicateStartTime = 0;
      }

      previousScene = scene;  // Update previous scene
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
function mapTranscriptionToScenes(
  scenesWithOCR: SceneWithOCR[],
  transcription: TranscriptionSegment[]
): SceneWithNarration[] {
  // Track segment usage for duplicate detection
  const segmentUsage = new Map<string, number[]>();

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
      segmentUsage.get(segKey)!.push(scene.sceneNumber);
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
      if (duplicateCount <= 3) {  // Show first 3 duplicates only
        console.warn(
          `[Narration] ⚠️ Duplicate detected in scenes ${sceneNumbers.join(', ')}: "${segKey}"`
        );
      }
    }
  });

  if (duplicateCount > 0) {
    console.warn(
      `[Narration] ⚠️ Total ${duplicateCount} narration segments appear in multiple scenes (unexpected with midpoint-based assignment)`
    );
  } else {
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
function convertScenesToExcelRows(scenes: SceneWithNarration[]): ExcelRow[] {
  return scenes.map(scene => ({
    sceneNumber: scene.sceneNumber,
    timecode: scene.timecode,
    screenshotPath: scene.screenshotPath!,
    ocrText: scene.ocrText || '',
    narrationText: scene.narrationText || ''
  }));
}

/**
 * Extended Scene interface with OCR
 */
interface SceneWithOCR extends Scene {
  ocrText: string;
  ocrConfidence: number;
}

/**
 * Extended Scene interface with OCR and narration
 */
interface SceneWithNarration extends SceneWithOCR {
  narrationText: string;
}

/**
 * Merge Enhanced mode detection results with standard scene detection
 *
 * This function:
 * 1. Creates new scenes from text stabilization results
 * 2. Filters out overlapping scenes (within 1 second of existing scenes)
 * 3. Merges and sorts by timestamp
 * 4. Re-numbers all scenes
 *
 * @param existingScenes - Scenes from standard detection
 * @param textResults - Text stabilization results from Enhanced mode
 * @returns Merged and sorted scenes
 */
function mergeEnhancedDetectionResults(
  existingScenes: Scene[],
  textResults: StableTextResult[]
): Scene[] {
  const OVERLAP_THRESHOLD = 1.0; // 1 second overlap threshold

  console.log(`  🔀 Merging ${existingScenes.length} standard scenes with ${textResults.length} enhanced results`);

  // Create new scenes from text stabilization results
  const enhancedScenes: Scene[] = textResults.map((result, index) => {
    // Find a reasonable end time (next scene start or +2 seconds)
    const nextResult = textResults[index + 1];
    const endTime = nextResult
      ? Math.min(nextResult.timestamp, result.timestamp + 2)
      : result.timestamp + 2;

    const startTime = result.timestamp;
    const midTime = (startTime + endTime) / 2;

    return {
      sceneNumber: 0, // Will be renumbered
      startTime,
      endTime,
      midTime,
      timecode: formatTimecode(startTime),
      screenshotPath: result.framePath, // Use the stabilized frame
    };
  });

  // Filter out enhanced scenes that overlap with existing scenes
  const nonOverlappingEnhancedScenes = enhancedScenes.filter(enhancedScene => {
    const overlaps = existingScenes.some(existingScene => {
      const timeDiff = Math.abs(enhancedScene.startTime - existingScene.startTime);
      return timeDiff < OVERLAP_THRESHOLD;
    });

    if (overlaps) {
      console.log(`    Skipping enhanced scene at ${enhancedScene.startTime.toFixed(2)}s (overlaps with existing)`);
    }

    return !overlaps;
  });

  console.log(`    Non-overlapping enhanced scenes: ${nonOverlappingEnhancedScenes.length}`);

  // Merge all scenes
  const mergedScenes = [...existingScenes, ...nonOverlappingEnhancedScenes];

  // Sort by start time
  mergedScenes.sort((a, b) => a.startTime - b.startTime);

  // Re-number scenes
  mergedScenes.forEach((scene, index) => {
    scene.sceneNumber = index + 1;
  });

  // Update end times and midTimes to be consistent (end = next scene start)
  for (let i = 0; i < mergedScenes.length - 1; i++) {
    mergedScenes[i].endTime = mergedScenes[i + 1].startTime;
    mergedScenes[i].midTime = (mergedScenes[i].startTime + mergedScenes[i].endTime) / 2;
  }

  console.log(`  ✓ Merged result: ${mergedScenes.length} total scenes`);

  return mergedScenes;
}

/**
 * Convert scene cuts (timestamps) to Scene objects with extracted frames
 *
 * @param cuts - Array of scene cuts with timestamps
 * @param videoPath - Path to original video (for high-quality frame extraction)
 * @param videoDuration - Total video duration in seconds
 * @returns Array of Scene objects with extracted screenshots
 */
async function convertCutsToScenes(
  cuts: SceneCut[],
  videoPath: string,
  videoDuration: number
): Promise<Scene[]> {
  // Sort cuts by timestamp
  const sortedCuts = [...cuts].sort((a, b) => a.timestamp - b.timestamp);

  // Create temp directory for frames
  const framesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enhanced-frames-'));

  const scenes: Scene[] = [];

  // Add scene at timestamp 0 if first cut is not at the start
  if (sortedCuts.length === 0 || sortedCuts[0].timestamp > 0.5) {
    const startTime = 0;
    const endTime = sortedCuts.length > 0 ? sortedCuts[0].timestamp : videoDuration;
    const midTime = (startTime + endTime) / 2;

    const framePath = path.join(framesDir, `scene_0001_${midTime.toFixed(3)}.png`);
    await extractFrameAtTime(videoPath, midTime, framePath);

    scenes.push({
      sceneNumber: 1,
      startTime,
      endTime,
      midTime,
      timecode: formatTimecode(startTime),
      screenshotPath: framePath,
    });
  }

  // Convert each cut to a scene
  for (let i = 0; i < sortedCuts.length; i++) {
    const cut = sortedCuts[i];
    const nextCut = sortedCuts[i + 1];

    const startTime = cut.timestamp;
    const endTime = nextCut ? nextCut.timestamp : videoDuration;
    const midTime = (startTime + endTime) / 2;

    const sceneNumber = scenes.length + 1;
    const framePath = path.join(framesDir, `scene_${String(sceneNumber).padStart(4, '0')}_${midTime.toFixed(3)}.png`);

    try {
      await extractFrameAtTime(videoPath, midTime, framePath);

      scenes.push({
        sceneNumber,
        startTime,
        endTime,
        midTime,
        timecode: formatTimecode(startTime),
        screenshotPath: framePath,
      });
    } catch (error) {
      console.warn(`  ⚠️ Failed to extract frame for scene ${sceneNumber} at ${midTime}s: ${error}`);
      // Skip this scene if frame extraction fails
    }
  }

  console.log(`  ✓ Converted ${cuts.length} cuts to ${scenes.length} scenes with frames`);
  return scenes;
}
