/**
 * FFmpeg Scene Detection Service
 * Implements multi-pass scene detection with mid-point frame extraction
 * Based on VideoContentAnalyzer V2's proven algorithm (100% OCR accuracy)
 *
 * Adapted from V1 for V2 architecture with Scene interface
 */
import { Scene, VideoMetadata } from '../types/excel.js';
/**
 * Progress callback for scene detection
 * @param currentTime - Current position in seconds
 * @param totalDuration - Total video duration in seconds
 * @param formattedProgress - Formatted string like "45:30 / 2:00:00"
 */
export type SceneDetectionProgressCallback = (currentTime: number, totalDuration: number, formattedProgress: string) => void;
/**
 * Extract frame at specific timestamp with adaptive quality optimization
 * Uses spawn directly with gVisor-compatible environment settings
 * @param videoPath - Path to the video file
 * @param timestamp - Time in seconds
 * @param outputPath - Output file path for frame
 * @param videoMetadata - Optional video metadata for adaptive resizing
 */
export declare function extractFrameAtTime(videoPath: string, timestamp: number, outputPath: string, videoMetadata?: VideoMetadata): Promise<void>;
/**
 * Get video metadata (duration, width, height, aspect ratio)
 * Uses fluent-ffmpeg's ffprobe with gVisor-compatible environment settings
 */
export declare function getVideoMetadata(videoPath: string): Promise<VideoMetadata>;
/**
 * Main scene detection and frame extraction function
 * Implements FFmpeg scene detection + mid-point frame extraction
 * @param videoPath - Path to the video file
 * @param outputDir - Directory for extracted frames (optional, defaults to /tmp/frames-{timestamp})
 * @param existingMetadata - Pre-fetched video metadata (optional, avoids duplicate ffprobe call)
 * @returns Array of Scene objects with screenshot paths
 */
export declare function extractScenesWithFrames(videoPath: string, outputDir?: string, existingMetadata?: VideoMetadata): Promise<Scene[]>;
/**
 * Clean up temporary frame files
 * @param scenes - Array of scenes with screenshot paths
 */
export declare function cleanupFrames(scenes: Scene[]): Promise<void>;
/**
 * Default batch size for frame extraction
 * Balances memory usage (~500MB per batch) with processing efficiency
 */
export declare const DEFAULT_BATCH_SIZE = 100;
/**
 * Detect scenes without extracting frames
 * Used for batch processing where frames are extracted in batches
 * @param videoPath - Path to the video file
 * @param existingMetadata - Pre-fetched video metadata (optional)
 * @returns Object containing scenes (without screenshots) and video metadata
 */
export declare function detectScenesOnly(videoPath: string, existingMetadata?: VideoMetadata, onProgress?: SceneDetectionProgressCallback): Promise<{
    scenes: Scene[];
    videoMetadata: VideoMetadata;
}>;
/**
 * Extract frames for a batch of scenes
 * @param videoPath - Path to the video file
 * @param scenes - Batch of scenes to extract frames for
 * @param framesDir - Directory to store extracted frames
 * @param videoMetadata - Video metadata for adaptive resizing
 * @returns Updated scenes with screenshotPath set
 */
export declare function extractFramesForBatch(videoPath: string, scenes: Scene[], framesDir: string, videoMetadata: VideoMetadata): Promise<Scene[]>;
/**
 * Cleanup frames for a specific batch of scenes
 * Removes only the frame files for the given scenes, not the entire directory
 * @param scenes - Batch of scenes with screenshotPath to cleanup
 */
export declare function cleanupBatchFrames(scenes: Scene[]): Promise<void>;
/**
 * Get current memory usage for monitoring
 * @returns Memory usage info in MB
 */
export declare function getMemoryUsage(): {
    heapUsed: number;
    heapTotal: number;
    rss: number;
    external: number;
};
/**
 * Log memory usage with label
 * @param label - Description of current operation
 */
export declare function logMemoryUsage(label: string): void;
/**
 * Video chunk info for parallel processing
 */
export interface VideoChunk {
    index: number;
    path: string;
    startTime: number;
    endTime: number;
    duration: number;
    offset: number;
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
export declare function transcodeToProcessingResolution(inputPath: string, outputPath: string, targetHeight?: number): Promise<string>;
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
export declare function splitVideoWithOverlap(inputPath: string, outputDir: string, chunkDuration?: number, overlapDuration?: number): Promise<VideoChunk[]>;
/**
 * Merge timestamps from multiple chunks with offset calculation
 * Handles deduplication of overlapping regions
 *
 * @param chunkResults - Array of results from each chunk worker
 * @param overlapDuration - Overlap duration for deduplication (default: 10)
 * @returns Merged and deduplicated timestamps
 */
export declare function mergeChunkTimestamps(chunkResults: Array<{
    chunk: VideoChunk;
    timestamps: number[];
}>, overlapDuration?: number): number[];
/**
 * Clean up chunk files
 * @param chunks - Array of VideoChunk to clean up
 */
export declare function cleanupChunks(chunks: VideoChunk[]): Promise<void>;
//# sourceMappingURL=ffmpeg.d.ts.map