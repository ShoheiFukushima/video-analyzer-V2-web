/**
 * TransNet V2 Detector
 *
 * Node.js wrapper for TransNet V2 Python script with parallel processing support.
 * Handles video chunk processing, timestamp merging, and fallback mechanisms.
 *
 * @author Claude Code (Anthropic)
 * @since 2026-01-17
 */
import type { SceneCut } from '../types/shared.js';
import { VideoChunk } from './ffmpeg.js';
export interface TransNetResult {
    timestamp: number;
    confidence: number;
    frame: number;
}
export interface TransNetChunkResult {
    chunk: VideoChunk;
    results: TransNetResult[];
    success: boolean;
    error?: string;
}
export interface TransNetDetectionResult {
    cuts: SceneCut[];
    success: boolean;
    fallbackUsed: boolean;
    error?: string;
    processingTimeMs: number;
}
export interface TransNetConfig {
    pythonPath: string;
    scriptPath: string;
    maxParallelWorkers: number;
    timeoutMs: number;
    minConfidence: number;
}
/**
 * Load TransNet configuration from environment variables
 */
export declare function loadTransNetConfig(): TransNetConfig;
/**
 * Check if TransNet V2 is enabled
 */
export declare function isTransNetEnabled(): boolean;
/**
 * Run TransNet V2 on a single video file
 *
 * @param videoPath - Path to the video file
 * @param config - TransNet configuration
 * @returns Detection results
 */
export declare function runTransNetOnVideo(videoPath: string, config?: TransNetConfig): Promise<TransNetResult[]>;
/**
 * Process multiple video chunks in parallel with worker pool
 *
 * @param chunks - Array of video chunks
 * @param config - TransNet configuration
 * @returns Array of chunk results
 */
export declare function processChunksInParallel(chunks: VideoChunk[], config?: TransNetConfig): Promise<TransNetChunkResult[]>;
/**
 * Merge chunk results into final scene cuts with offset calculation
 *
 * @param chunkResults - Array of chunk results
 * @param config - TransNet configuration
 * @returns Merged scene cuts
 */
export declare function mergeChunkResults(chunkResults: TransNetChunkResult[], config?: TransNetConfig): SceneCut[];
/**
 * Detect scene cuts using TransNet V2 with parallel chunk processing
 *
 * @param videoPath - Path to the video file (or chunks)
 * @param chunks - Optional pre-split video chunks
 * @returns Detection result with scene cuts
 */
export declare function detectWithTransNet(videoPath: string, chunks?: VideoChunk[]): Promise<TransNetDetectionResult>;
/**
 * Detect scenes with TransNet V2, falling back to FFmpeg on failure
 *
 * @param videoPath - Path to the video file
 * @param chunks - Optional pre-split video chunks
 * @param ffmpegFallback - Fallback function for FFmpeg detection
 * @param onFallback - Callback when fallback is triggered
 * @returns Detection result
 */
export declare function detectWithTransNetAndFallback(videoPath: string, chunks: VideoChunk[] | undefined, ffmpegFallback: (videoPath: string) => Promise<SceneCut[]>, onFallback?: (error: string, uploadId?: string) => Promise<void>): Promise<TransNetDetectionResult>;
/**
 * Validate TransNet V2 installation
 *
 * @returns Validation result
 */
export declare function validateTransNetInstallation(): Promise<{
    valid: boolean;
    pythonVersion?: string;
    transnetVersion?: string;
    error?: string;
}>;
/**
 * Get TransNet V2 detection statistics
 *
 * @param results - Detection results
 * @returns Statistics object
 */
export declare function getTransNetStatistics(results: TransNetResult[]): {
    totalCuts: number;
    avgConfidence: number;
    minConfidence: number;
    maxConfidence: number;
    confidenceDistribution: {
        low: number;
        medium: number;
        high: number;
    };
};
//# sourceMappingURL=transnetDetector.d.ts.map