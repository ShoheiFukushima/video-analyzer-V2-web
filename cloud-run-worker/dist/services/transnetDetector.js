/**
 * TransNet V2 Detector
 *
 * Node.js wrapper for TransNet V2 Python script with parallel processing support.
 * Handles video chunk processing, timestamp merging, and fallback mechanisms.
 *
 * @author Claude Code (Anthropic)
 * @since 2026-01-17
 */
import { spawn } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { mergeChunkTimestamps } from './ffmpeg.js';
// ============================================================
// Configuration
// ============================================================
const DEFAULT_CONFIG = {
    pythonPath: '/opt/venv/bin/python3',
    scriptPath: '/app/transnetRunner.py',
    maxParallelWorkers: 4,
    timeoutMs: 300000, // 5 minutes per chunk
    minConfidence: 0.3,
};
/**
 * Load TransNet configuration from environment variables
 */
export function loadTransNetConfig() {
    return {
        pythonPath: process.env.TRANSNET_PYTHON_PATH || DEFAULT_CONFIG.pythonPath,
        scriptPath: process.env.TRANSNET_SCRIPT_PATH || DEFAULT_CONFIG.scriptPath,
        maxParallelWorkers: parseInt(process.env.TRANSNET_MAX_WORKERS || '4', 10),
        timeoutMs: parseInt(process.env.TRANSNET_TIMEOUT_MS || '300000', 10),
        minConfidence: parseFloat(process.env.TRANSNET_MIN_CONFIDENCE || '0.3'),
    };
}
/**
 * Check if TransNet V2 is enabled
 */
export function isTransNetEnabled() {
    return process.env.TRANSNET_V2_ENABLED === 'true';
}
// ============================================================
// Core Detection Functions
// ============================================================
/**
 * Run TransNet V2 on a single video file
 *
 * @param videoPath - Path to the video file
 * @param config - TransNet configuration
 * @returns Detection results
 */
export async function runTransNetOnVideo(videoPath, config = loadTransNetConfig()) {
    const outputJson = path.join(os.tmpdir(), `transnet_${Date.now()}_${Math.random().toString(36).slice(2)}.json`);
    return new Promise((resolve, reject) => {
        const process = spawn(config.pythonPath, [config.scriptPath, videoPath, outputJson], {
            timeout: config.timeoutMs,
        });
        let stderr = '';
        process.stderr.on('data', (data) => {
            stderr += data.toString();
            console.log(`[TransNet] ${data.toString().trim()}`);
        });
        process.on('close', async (code) => {
            if (code !== 0) {
                reject(new Error(`TransNet process exited with code ${code}: ${stderr}`));
                return;
            }
            try {
                const jsonContent = await fs.readFile(outputJson, 'utf-8');
                const results = JSON.parse(jsonContent);
                // Cleanup temp file
                await fs.unlink(outputJson).catch(() => { });
                resolve(results);
            }
            catch (error) {
                reject(new Error(`Failed to parse TransNet output: ${error}`));
            }
        });
        process.on('error', (error) => {
            reject(new Error(`Failed to spawn TransNet process: ${error.message}`));
        });
    });
}
/**
 * Process a single video chunk with TransNet V2
 *
 * @param chunk - Video chunk to process
 * @param config - TransNet configuration
 * @returns Chunk processing result
 */
async function processChunk(chunk, config) {
    const startTime = Date.now();
    console.log(`[TransNet] Processing chunk ${chunk.index}: ${chunk.path} (offset: ${chunk.offset}s)`);
    try {
        const results = await runTransNetOnVideo(chunk.path, config);
        const processingTime = Date.now() - startTime;
        console.log(`[TransNet] Chunk ${chunk.index} completed: ${results.length} cuts found in ${processingTime}ms`);
        return {
            chunk,
            results,
            success: true,
        };
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`[TransNet] Chunk ${chunk.index} failed: ${errorMessage}`);
        return {
            chunk,
            results: [],
            success: false,
            error: errorMessage,
        };
    }
}
/**
 * Process multiple video chunks in parallel with worker pool
 *
 * @param chunks - Array of video chunks
 * @param config - TransNet configuration
 * @returns Array of chunk results
 */
export async function processChunksInParallel(chunks, config = loadTransNetConfig()) {
    const results = [];
    const maxWorkers = Math.min(config.maxParallelWorkers, chunks.length);
    console.log(`[TransNet] Processing ${chunks.length} chunks with ${maxWorkers} parallel workers`);
    // Process in batches based on maxWorkers
    for (let i = 0; i < chunks.length; i += maxWorkers) {
        const batch = chunks.slice(i, i + maxWorkers);
        const batchPromises = batch.map((chunk) => processChunk(chunk, config));
        const batchResults = await Promise.all(batchPromises);
        results.push(...batchResults);
        console.log(`[TransNet] Batch ${Math.floor(i / maxWorkers) + 1}/${Math.ceil(chunks.length / maxWorkers)} completed`);
    }
    return results;
}
/**
 * Merge chunk results into final scene cuts with offset calculation
 *
 * @param chunkResults - Array of chunk results
 * @param config - TransNet configuration
 * @returns Merged scene cuts
 */
export function mergeChunkResults(chunkResults, config = loadTransNetConfig()) {
    // Prepare data for merging
    const chunkTimestamps = chunkResults
        .filter((r) => r.success)
        .map((r) => ({
        chunk: r.chunk,
        timestamps: r.results
            .filter((t) => t.confidence >= config.minConfidence)
            .map((t) => t.timestamp),
    }));
    // Use ffmpeg's merge function for offset calculation and deduplication
    const mergedTimestamps = mergeChunkTimestamps(chunkTimestamps);
    // Convert to SceneCut format
    return mergedTimestamps.map((timestamp) => ({
        timestamp,
        confidence: 0.9, // TransNet V2 default confidence
        source: 'transnet_v2',
    }));
}
// ============================================================
// Main Detection Entry Point
// ============================================================
/**
 * Detect scene cuts using TransNet V2 with parallel chunk processing
 *
 * @param videoPath - Path to the video file (or chunks)
 * @param chunks - Optional pre-split video chunks
 * @returns Detection result with scene cuts
 */
export async function detectWithTransNet(videoPath, chunks) {
    const startTime = Date.now();
    const config = loadTransNetConfig();
    console.log('[TransNet] Starting TransNet V2 scene detection');
    console.log(`[TransNet] Config: maxWorkers=${config.maxParallelWorkers}, timeout=${config.timeoutMs}ms, minConfidence=${config.minConfidence}`);
    try {
        let cuts;
        if (chunks && chunks.length > 0) {
            // Process pre-split chunks in parallel
            console.log(`[TransNet] Processing ${chunks.length} pre-split chunks`);
            const chunkResults = await processChunksInParallel(chunks, config);
            // Check if all chunks failed
            const successCount = chunkResults.filter((r) => r.success).length;
            if (successCount === 0) {
                throw new Error('All chunks failed to process');
            }
            console.log(`[TransNet] ${successCount}/${chunks.length} chunks processed successfully`);
            cuts = mergeChunkResults(chunkResults, config);
        }
        else {
            // Process single video file
            console.log('[TransNet] Processing single video file');
            const results = await runTransNetOnVideo(videoPath, config);
            cuts = results
                .filter((r) => r.confidence >= config.minConfidence)
                .map((r) => ({
                timestamp: r.timestamp,
                confidence: r.confidence,
                source: 'transnet_v2',
            }));
        }
        const processingTimeMs = Date.now() - startTime;
        console.log(`[TransNet] Detection completed: ${cuts.length} scene cuts found in ${processingTimeMs}ms`);
        return {
            cuts,
            success: true,
            fallbackUsed: false,
            processingTimeMs,
        };
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const processingTimeMs = Date.now() - startTime;
        console.error(`[TransNet] Detection failed after ${processingTimeMs}ms: ${errorMessage}`);
        return {
            cuts: [],
            success: false,
            fallbackUsed: false,
            error: errorMessage,
            processingTimeMs,
        };
    }
}
// ============================================================
// Fallback Integration
// ============================================================
/**
 * Detect scenes with TransNet V2, falling back to FFmpeg on failure
 *
 * @param videoPath - Path to the video file
 * @param chunks - Optional pre-split video chunks
 * @param ffmpegFallback - Fallback function for FFmpeg detection
 * @param onFallback - Callback when fallback is triggered
 * @returns Detection result
 */
export async function detectWithTransNetAndFallback(videoPath, chunks, ffmpegFallback, onFallback) {
    // First, try TransNet V2
    const transnetResult = await detectWithTransNet(videoPath, chunks);
    if (transnetResult.success) {
        return transnetResult;
    }
    // TransNet failed, trigger fallback notification
    console.warn('[TransNet] Falling back to FFmpeg detection');
    if (onFallback) {
        await onFallback(transnetResult.error || 'Unknown error').catch((e) => {
            console.error('[TransNet] Fallback notification failed:', e);
        });
    }
    // Run FFmpeg fallback
    const startTime = Date.now();
    try {
        const ffmpegCuts = await ffmpegFallback(videoPath);
        const processingTimeMs = Date.now() - startTime;
        console.log(`[TransNet] FFmpeg fallback completed: ${ffmpegCuts.length} cuts in ${processingTimeMs}ms`);
        return {
            cuts: ffmpegCuts,
            success: true,
            fallbackUsed: true,
            processingTimeMs: transnetResult.processingTimeMs + processingTimeMs,
        };
    }
    catch (ffmpegError) {
        const errorMessage = ffmpegError instanceof Error ? ffmpegError.message : String(ffmpegError);
        return {
            cuts: [],
            success: false,
            fallbackUsed: true,
            error: `TransNet failed: ${transnetResult.error}. FFmpeg fallback also failed: ${errorMessage}`,
            processingTimeMs: Date.now() - startTime + transnetResult.processingTimeMs,
        };
    }
}
// ============================================================
// Utility Functions
// ============================================================
/**
 * Validate TransNet V2 installation
 *
 * @returns Validation result
 */
export async function validateTransNetInstallation() {
    const config = loadTransNetConfig();
    return new Promise((resolve) => {
        const process = spawn(config.pythonPath, ['-c', `
import sys
print(f"python:{sys.version.split()[0]}")
try:
    import transnetv2
    print(f"transnet:installed")
except ImportError as e:
    print(f"transnet:error:{e}")
`]);
        let stdout = '';
        let stderr = '';
        process.stdout.on('data', (data) => {
            stdout += data.toString();
        });
        process.stderr.on('data', (data) => {
            stderr += data.toString();
        });
        process.on('close', (code) => {
            if (code !== 0) {
                resolve({
                    valid: false,
                    error: `Python check failed: ${stderr || 'Unknown error'}`,
                });
                return;
            }
            const lines = stdout.trim().split('\n');
            const pythonLine = lines.find((l) => l.startsWith('python:'));
            const transnetLine = lines.find((l) => l.startsWith('transnet:'));
            const pythonVersion = pythonLine?.split(':')[1];
            const transnetStatus = transnetLine?.split(':')[1];
            if (transnetStatus === 'installed') {
                resolve({
                    valid: true,
                    pythonVersion,
                    transnetVersion: 'installed',
                });
            }
            else {
                resolve({
                    valid: false,
                    pythonVersion,
                    error: `TransNet V2 not installed: ${transnetLine}`,
                });
            }
        });
        process.on('error', (error) => {
            resolve({
                valid: false,
                error: `Failed to spawn Python: ${error.message}`,
            });
        });
    });
}
/**
 * Get TransNet V2 detection statistics
 *
 * @param results - Detection results
 * @returns Statistics object
 */
export function getTransNetStatistics(results) {
    if (results.length === 0) {
        return {
            totalCuts: 0,
            avgConfidence: 0,
            minConfidence: 0,
            maxConfidence: 0,
            confidenceDistribution: { low: 0, medium: 0, high: 0 },
        };
    }
    const confidences = results.map((r) => r.confidence);
    const sum = confidences.reduce((a, b) => a + b, 0);
    return {
        totalCuts: results.length,
        avgConfidence: sum / results.length,
        // Use reduce instead of spread to avoid "Maximum call stack size exceeded" for large arrays
        minConfidence: confidences.reduce((min, c) => Math.min(min, c), Infinity),
        maxConfidence: confidences.reduce((max, c) => Math.max(max, c), -Infinity),
        confidenceDistribution: {
            low: confidences.filter((c) => c < 0.5).length,
            medium: confidences.filter((c) => c >= 0.5 && c < 0.8).length,
            high: confidences.filter((c) => c >= 0.8).length,
        },
    };
}
//# sourceMappingURL=transnetDetector.js.map