/**
 * FFmpeg Scene Detection Service
 * Implements multi-pass scene detection with mid-point frame extraction
 * Based on VideoContentAnalyzer V2's proven algorithm (100% OCR accuracy)
 *
 * Adapted from V1 for V2 architecture with Scene interface
 */
import { Scene, VideoMetadata } from '../types/excel.js';
/**
 * Get video metadata (duration, width, height, aspect ratio)
 */
export declare function getVideoMetadata(videoPath: string): Promise<VideoMetadata>;
/**
 * Main scene detection and frame extraction function
 * Implements FFmpeg scene detection + mid-point frame extraction
 * @param videoPath - Path to the video file
 * @param outputDir - Directory for extracted frames (optional, defaults to /tmp/frames-{timestamp})
 * @returns Array of Scene objects with screenshot paths
 */
export declare function extractScenesWithFrames(videoPath: string, outputDir?: string): Promise<Scene[]>;
/**
 * Clean up temporary frame files
 * @param scenes - Array of scenes with screenshot paths
 */
export declare function cleanupFrames(scenes: Scene[]): Promise<void>;
//# sourceMappingURL=ffmpeg.d.ts.map