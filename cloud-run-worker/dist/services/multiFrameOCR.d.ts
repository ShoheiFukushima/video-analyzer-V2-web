/**
 * Multi-Frame OCR Service
 *
 * Extracts and analyzes multiple frames per scene to:
 * - Catch text that appears via animation/fade
 * - Find the best frame for OCR
 * - Detect text appearance timing
 *
 * Used in Enhanced mode for standard scenes (not just stabilization points)
 *
 * @module multiFrameOCR
 */
import { GenerativeModel } from '@google/generative-ai';
import { RateLimiter } from './rateLimiter.js';
import type { Scene } from '../types/excel.js';
export interface MultiFrameConfig {
    /** Frame positions within scene (default: [0.25, 0.5, 0.75]) */
    positions: number[];
    /** Frame selection strategy */
    strategy: 'first_stable' | 'most_text' | 'highest_confidence';
}
export interface FrameOCRResult {
    /** Position within scene (0-1) */
    position: number;
    /** Absolute timestamp in seconds */
    timestamp: number;
    /** Path to extracted frame */
    path: string;
    /** Extracted text */
    text: string;
    /** OCR confidence (0-1) */
    confidence: number;
}
export interface MultiFrameOCRResult {
    /** Best frame selected by strategy */
    bestFrame: FrameOCRResult;
    /** All frame results */
    allFrames: FrameOCRResult[];
    /** Position where text first appears (if detected) */
    textAppearancePosition?: number;
    /** Position where text stabilizes (if detected) */
    textStabilityPosition?: number;
}
export interface SceneWithMultiFrameOCR extends Scene {
    ocrText: string;
    ocrConfidence: number;
    textAppearancePosition?: number;
    textStabilityPosition?: number;
}
/**
 * Extract multiple frames from a scene at specified positions
 *
 * @param videoPath - Path to video file
 * @param scene - Scene to extract frames from
 * @param outputDir - Directory to save frames
 * @param config - Configuration options
 * @returns Array of extracted frame paths with timestamps
 */
export declare function extractMultipleFrames(videoPath: string, scene: Scene, outputDir: string, config?: Partial<MultiFrameConfig>): Promise<{
    position: number;
    timestamp: number;
    path: string;
}[]>;
/**
 * Perform OCR on multiple frames and select the best result
 *
 * @param scene - Scene being processed
 * @param frames - Extracted frames
 * @param model - Gemini model
 * @param rateLimiter - Rate limiter
 * @param config - Configuration
 * @returns Multi-frame OCR result
 */
export declare function performMultiFrameOCR(scene: Scene, frames: {
    position: number;
    timestamp: number;
    path: string;
}[], model: GenerativeModel, rateLimiter: RateLimiter, config?: Partial<MultiFrameConfig>): Promise<MultiFrameOCRResult>;
/**
 * Process multiple scenes with multi-frame OCR
 *
 * @param scenes - Scenes to process
 * @param videoPath - Path to video file
 * @param outputDir - Directory for temporary frames
 * @param uploadId - Optional upload ID for progress tracking
 * @returns Scenes with OCR results
 */
export declare function processMultiFrameOCRBatch(scenes: Scene[], videoPath: string, outputDir: string, uploadId?: string): Promise<SceneWithMultiFrameOCR[]>;
//# sourceMappingURL=multiFrameOCR.d.ts.map