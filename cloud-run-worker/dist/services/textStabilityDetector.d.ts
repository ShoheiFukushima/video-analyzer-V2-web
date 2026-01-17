/**
 * Text Stability Detector
 *
 * Detects when text becomes stable (fully visible and readable) in video frames.
 * Used in Enhanced mode to capture text after dissolve/fade animations complete.
 *
 * Features:
 * - Extracts multiple frames around stabilization points
 * - Runs OCR on each frame to detect text appearance
 * - Identifies the first frame where text is stable (2 consecutive frames with same text)
 * - Classifies content as TEXT vs OBJECT for weighted scoring
 *
 * @module textStabilityDetector
 */
import { GenerativeModel } from '@google/generative-ai';
import { RateLimiter } from './rateLimiter.js';
import type { StabilizationPoint } from './luminanceDetector.js';
export interface TextStabilityConfig {
    /** Interval between frames in seconds (default: 0.1) */
    frameInterval: number;
    /** Number of frames to check (default: 5) */
    framesToCheck: number;
    /** Number of consecutive matching frames for stability (default: 2) */
    stabilityThreshold: number;
}
export interface TextClassification {
    type: 'text' | 'object' | 'mixed';
    confidence: number;
    categories: {
        subtitle: number;
        title: number;
        caption: number;
        logo: number;
        graphic: number;
    };
}
export interface FrameOCRResult {
    timestamp: number;
    path: string;
    text: string;
    confidence: number;
}
export interface StableTextResult {
    timestamp: number;
    text: string;
    classification: TextClassification;
    stabilityScore: number;
    framePath: string;
    finalScore: number;
    stabilizationPoint: StabilizationPoint;
}
/**
 * Extract multiple frames around a stabilization point
 *
 * @param videoPath - Path to video file
 * @param stabilizationPoint - The stabilization point to analyze
 * @param outputDir - Directory to save extracted frames
 * @param config - Configuration options
 * @returns Array of extracted frame paths with timestamps
 */
export declare function extractStabilizationFrames(videoPath: string, stabilizationPoint: StabilizationPoint, outputDir: string, config?: Partial<TextStabilityConfig>): Promise<{
    timestamp: number;
    path: string;
}[]>;
/**
 * Perform OCR on multiple frames to detect text stabilization
 *
 * @param frames - Array of frame paths with timestamps
 * @param model - Gemini generative model
 * @param rateLimiter - Rate limiter for API calls
 * @returns Array of OCR results for each frame
 */
export declare function performFrameOCR(frames: {
    timestamp: number;
    path: string;
}[], model: GenerativeModel, rateLimiter: RateLimiter): Promise<FrameOCRResult[]>;
/**
 * Classify content in a frame as TEXT or OBJECT
 *
 * @param framePath - Path to frame image
 * @param model - Gemini generative model
 * @param rateLimiter - Rate limiter for API calls
 * @returns Text classification result
 */
export declare function classifyContent(framePath: string, model: GenerativeModel, rateLimiter: RateLimiter): Promise<TextClassification>;
/**
 * Find the first stable text frame (2 consecutive frames with same text)
 *
 * @param ocrResults - OCR results for all frames
 * @returns The stable frame result or null if no stability found
 */
export declare function findStableTextFrame(ocrResults: FrameOCRResult[]): FrameOCRResult | null;
/**
 * Calculate final score based on text classification and stability
 *
 * @param classification - Content classification result
 * @param stabilityScore - Stability score (0-1)
 * @returns Final weighted score
 */
export declare function calculateFinalScore(classification: TextClassification, stabilityScore: number): number;
/**
 * Detect text stabilization at a given stabilization point
 *
 * @param videoPath - Path to video file
 * @param stabilizationPoint - The stabilization point to analyze
 * @param outputDir - Directory for temporary frames
 * @param model - Gemini generative model
 * @param rateLimiter - Rate limiter for API calls
 * @param config - Configuration options
 * @returns Stable text result or null if no text detected
 */
export declare function detectTextStabilization(videoPath: string, stabilizationPoint: StabilizationPoint, outputDir: string, model: GenerativeModel, rateLimiter: RateLimiter, config?: Partial<TextStabilityConfig>): Promise<StableTextResult | null>;
/**
 * Process multiple stabilization points and return all text results
 *
 * @param videoPath - Path to video file
 * @param stabilizationPoints - Array of stabilization points to analyze
 * @param outputDir - Directory for temporary frames
 * @param config - Configuration options
 * @returns Array of stable text results
 */
export declare function processStabilizationPoints(videoPath: string, stabilizationPoints: StabilizationPoint[], outputDir: string, config?: Partial<TextStabilityConfig>): Promise<StableTextResult[]>;
//# sourceMappingURL=textStabilityDetector.d.ts.map