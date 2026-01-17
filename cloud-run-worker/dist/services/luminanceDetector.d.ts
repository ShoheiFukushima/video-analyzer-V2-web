/**
 * Luminance-Based Scene Detection
 *
 * Detects video transitions that standard scene detection misses:
 * - Fade in/out (black or white)
 * - Dissolve transitions
 * - Flash effects
 *
 * Uses FFmpeg signalstats filter to track average luminance (YAVG)
 *
 * @module luminanceDetector
 */
export interface LuminanceSample {
    timestamp: number;
    luminance: number;
}
export interface LuminanceConfig {
    /** Frames per second for sampling (default: 10) */
    sampleFps: number;
    /** Luminance threshold for white screen detection (default: 230) */
    whiteThreshold: number;
    /** Luminance threshold for black screen detection (default: 25) */
    blackThreshold: number;
    /** Luminance change % to consider stable (default: 0.03 = 3%) */
    stabilityThreshold: number;
    /** Duration in seconds for stability check (default: 0.3) */
    stabilityDuration: number;
    /** Minimum white screen duration in seconds (default: 0.5) */
    minWhiteDuration: number;
}
export interface WhiteScreenInterval {
    start: number;
    end: number;
    avgLuminance: number;
}
export interface StabilizationPoint {
    timestamp: number;
    type: 'from_white' | 'from_black' | 'general';
    luminanceBefore: number;
    luminanceAfter: number;
    confidence: number;
}
/**
 * Extract luminance data from video using FFmpeg signalstats
 *
 * @param videoPath - Path to video file
 * @param config - Detection configuration
 * @returns Array of luminance samples with timestamps
 */
export declare function extractLuminanceData(videoPath: string, config?: Partial<LuminanceConfig>): Promise<LuminanceSample[]>;
/**
 * Detect white screen intervals in luminance data
 *
 * @param samples - Array of luminance samples
 * @param config - Detection configuration
 * @returns Array of white screen intervals with start/end times
 */
export declare function detectWhiteScreenIntervals(samples: LuminanceSample[], config?: Partial<LuminanceConfig>): WhiteScreenInterval[];
/**
 * Detect black screen intervals in luminance data
 *
 * @param samples - Array of luminance samples
 * @param config - Detection configuration
 * @returns Array of black screen intervals with start/end times
 */
export declare function detectBlackScreenIntervals(samples: LuminanceSample[], config?: Partial<LuminanceConfig>): WhiteScreenInterval[];
/**
 * Detect stabilization points after white/black screen intervals
 *
 * A stabilization point is where the luminance stops changing significantly,
 * indicating that a fade/dissolve transition has completed.
 *
 * @param samples - Array of luminance samples
 * @param intervals - Array of white or black screen intervals
 * @param type - Type of interval ('from_white' or 'from_black')
 * @param config - Detection configuration
 * @returns Array of stabilization points
 */
export declare function detectStabilizationPoints(samples: LuminanceSample[], intervals: WhiteScreenInterval[], type: 'from_white' | 'from_black', config?: Partial<LuminanceConfig>): StabilizationPoint[];
/**
 * Run full luminance-based detection pipeline
 *
 * @param videoPath - Path to video file
 * @param config - Detection configuration
 * @returns Object containing all detection results
 */
export declare function runLuminanceDetection(videoPath: string, config?: Partial<LuminanceConfig>): Promise<{
    samples: LuminanceSample[];
    whiteIntervals: WhiteScreenInterval[];
    blackIntervals: WhiteScreenInterval[];
    stabilizationPoints: StabilizationPoint[];
}>;
/**
 * Get stabilization points only (convenience function)
 *
 * @param videoPath - Path to video file
 * @param config - Detection configuration
 * @returns Array of stabilization points
 */
export declare function getStabilizationPoints(videoPath: string, config?: Partial<LuminanceConfig>): Promise<StabilizationPoint[]>;
//# sourceMappingURL=luminanceDetector.d.ts.map