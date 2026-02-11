/**
 * Single Batch Processor
 *
 * Processes a single batch of scenes (frame extraction + OCR).
 * Called by Cloud Tasks for each batch.
 */
import * as path from 'path';
import * as os from 'os';
import * as fsPromises from 'fs/promises';
import * as fs from 'fs';
import { loadCheckpoint, addCompletedOcrScenes } from './checkpointService.js';
import { getOCRRouter } from './ocrRouter.js';
import { extractFrameAtTime } from './ffmpeg.js';
import { downloadFromR2Parallel } from './r2Client.js';
import { updateStatus } from './statusManager.js';
/**
 * Process a single batch of scenes
 */
export async function processSingleBatch(payload) {
    const { uploadId, batchIndex, totalBatches, startSceneIndex, endSceneIndex, videoPath, videoDuration, isLastBatch, } = payload;
    const batchNumber = batchIndex + 1;
    const scenesInBatch = endSceneIndex - startSceneIndex;
    console.log(`\n[${uploadId}] ━━━ Batch ${batchNumber}/${totalBatches} ━━━`);
    console.log(`  Scenes: ${startSceneIndex + 1} - ${endSceneIndex}`);
    console.log(`  Count: ${scenesInBatch}`);
    // Load checkpoint to get scene data and existing OCR results
    const checkpoint = await loadCheckpoint(uploadId);
    if (!checkpoint) {
        throw new Error('Checkpoint not found - cannot process batch');
    }
    const scenes = checkpoint.sceneCuts;
    if (!scenes || scenes.length === 0) {
        throw new Error('No scenes found in checkpoint');
    }
    const batchScenes = scenes.slice(startSceneIndex, endSceneIndex);
    console.log(`  Loaded ${batchScenes.length} scenes from checkpoint`);
    // Check for cached OCR results
    const cachedOcrResults = checkpoint.ocrResults || {};
    const scenesToProcess = [];
    const cachedResults = {};
    for (let i = 0; i < batchScenes.length; i++) {
        const globalIndex = startSceneIndex + i;
        if (cachedOcrResults[globalIndex] !== undefined) {
            cachedResults[globalIndex] = cachedOcrResults[globalIndex];
        }
        else {
            scenesToProcess.push(batchScenes[i]);
        }
    }
    console.log(`  Cached: ${Object.keys(cachedResults).length}, To process: ${scenesToProcess.length}`);
    // If all cached, skip processing
    if (scenesToProcess.length === 0) {
        console.log(`  All scenes cached, skipping batch processing`);
        return {
            batchIndex,
            processedScenes: endSceneIndex,
            totalScenes: scenes.length,
            ocrResults: cachedResults,
        };
    }
    // Download video if needed (check if local file exists)
    const localVideoPath = `/tmp/video-${uploadId}.mp4`;
    try {
        await fsPromises.access(localVideoPath);
        console.log(`  Video already downloaded: ${localVideoPath}`);
    }
    catch {
        console.log(`  Downloading video from R2: ${videoPath}`);
        await downloadFromR2Parallel(videoPath, localVideoPath);
        const stats = await fsPromises.stat(localVideoPath);
        console.log(`  Video downloaded: ${(stats.size / 1024 / 1024).toFixed(1)}MB`);
    }
    // Create temporary directory for frames
    const framesDir = path.join(os.tmpdir(), `batch-${uploadId}-${batchIndex}`);
    await fsPromises.mkdir(framesDir, { recursive: true });
    try {
        // Extract frames for scenes to process
        console.log(`  [1/3] Extracting ${scenesToProcess.length} frames...`);
        const scenesWithFrames = await extractFramesForScenes(localVideoPath, scenesToProcess, framesDir, startSceneIndex);
        // Run OCR on extracted frames
        console.log(`  [2/3] Running OCR on ${scenesWithFrames.length} frames...`);
        const ocrResults = await runOcrOnScenes(uploadId, scenesWithFrames, videoDuration, batchNumber, totalBatches);
        // Merge with cached results
        const allResults = { ...cachedResults, ...ocrResults };
        // Save OCR results to checkpoint
        console.log(`  [3/3] Saving ${Object.keys(ocrResults).length} OCR results to checkpoint...`);
        // Use addCompletedOcrScenes to save incrementally
        const newSceneIndices = Object.keys(ocrResults).map(Number);
        await addCompletedOcrScenes(uploadId, newSceneIndices, ocrResults);
        // Cleanup frames
        await fsPromises.rm(framesDir, { recursive: true, force: true });
        console.log(`  Cleaned up batch frames`);
        // If this is the last batch, update status to trigger Excel generation
        if (isLastBatch) {
            console.log(`\n[${uploadId}] All batches complete, signaling completion...`);
            await updateStatus(uploadId, {
                progress: 90,
                message: 'All OCR batches complete, generating Excel...',
                stage: 'excel_generation',
            });
        }
        console.log(`  Batch ${batchNumber} complete: ${Object.keys(ocrResults).length} new OCR results`);
        return {
            batchIndex,
            processedScenes: endSceneIndex,
            totalScenes: scenes.length,
            ocrResults: allResults,
        };
    }
    catch (error) {
        // Cleanup on error
        await fsPromises.rm(framesDir, { recursive: true, force: true }).catch(() => { });
        throw error;
    }
}
/**
 * Extract frames for a list of scenes
 */
async function extractFramesForScenes(videoPath, scenes, framesDir, globalIndexOffset) {
    const results = [];
    // Extract frames in parallel with concurrency limit
    const CONCURRENCY = 4;
    for (let i = 0; i < scenes.length; i += CONCURRENCY) {
        const chunk = scenes.slice(i, i + CONCURRENCY);
        const promises = chunk.map(async (scene, j) => {
            const globalIndex = globalIndexOffset + i + j;
            const framePath = path.join(framesDir, `frame-${globalIndex}.jpg`);
            // Extract frame at scene midpoint
            const midpoint = (scene.startTime + scene.endTime) / 2;
            await extractFrameAtTime(videoPath, midpoint, framePath);
            return {
                ...scene,
                framePath,
                globalIndex,
            };
        });
        const chunkResults = await Promise.all(promises);
        results.push(...chunkResults);
    }
    return results;
}
/**
 * Run OCR on scenes with extracted frames
 */
async function runOcrOnScenes(uploadId, scenes, videoDuration, batchNumber, totalBatches) {
    const ocrRouter = getOCRRouter();
    const results = {};
    // Set video duration for auto parallel boost
    ocrRouter.setVideoDuration(videoDuration);
    // Prepare OCR tasks
    const tasks = [];
    const sceneIndexMap = new Map(); // task id -> globalIndex
    for (const scene of scenes) {
        try {
            const imageBuffer = fs.readFileSync(scene.framePath);
            const taskId = scene.globalIndex;
            tasks.push({
                id: taskId,
                imageBuffer,
                metadata: { sceneIndex: scene.globalIndex },
            });
            sceneIndexMap.set(taskId, scene.globalIndex);
        }
        catch (error) {
            console.warn(`  Failed to read frame for scene ${scene.globalIndex}`);
        }
    }
    if (tasks.length === 0) {
        return results;
    }
    // Run OCR with router
    const batchResult = await ocrRouter.processParallel(tasks);
    // Map results by scene index
    for (let i = 0; i < batchResult.results.length; i++) {
        const result = batchResult.results[i];
        const taskId = tasks[i].id;
        const globalIndex = sceneIndexMap.get(taskId);
        if (globalIndex !== undefined && result.text) {
            results[globalIndex] = result.text;
        }
    }
    console.log(`  OCR complete: ${Object.keys(results).length}/${tasks.length} scenes with text`);
    return results;
}
//# sourceMappingURL=batchProcessor.js.map