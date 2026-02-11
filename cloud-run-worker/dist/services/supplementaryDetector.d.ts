/**
 * Supplementary Scene Detection
 *
 * Detects scene boundaries that TransNet V2 might miss:
 * - Constant luminance sections (≥3 seconds)
 * - Black sections
 * - PAN/motion sections
 *
 * @author Claude Code (Anthropic)
 * @since 2026-01-17
 */
import type { SceneCut } from '../types/shared.js';
export interface LuminanceSection {
    startTime: number;
    endTime: number;
    duration: number;
    avgLuminance: number;
    type: 'constant' | 'black' | 'white';
}
export interface MotionSection {
    startTime: number;
    endTime: number;
    duration: number;
    avgMotion: number;
    type: 'static' | 'pan' | 'zoom' | 'high_motion';
}
export interface SupplementaryConfig {
    /** Minimum duration for constant luminance sections (seconds) */
    minConstantLuminanceDuration: number;
    /** Luminance change threshold (0-255) */
    luminanceChangeThreshold: number;
    /** Black detection pixel threshold (0-1) */
    blackPixelThreshold: number;
    /** Minimum black section duration (seconds) */
    minBlackDuration: number;
    /** Motion detection sensitivity (0-1) */
    motionSensitivity: number;
}
export interface SupplementaryDetectionResult {
    cuts: SceneCut[];
    luminanceSections: LuminanceSection[];
    motionSections: MotionSection[];
    processingTimeMs: number;
}
/**
 * Load supplementary detection configuration from environment
 */
export declare function loadSupplementaryConfig(): SupplementaryConfig;
/**
 * Detect black sections in video using FFmpeg blackdetect
 *
 * @param videoPath - Path to the video file
 * @param config - Detection configuration
 * @returns Array of black sections
 */
export declare function detectBlackSections(videoPath: string, config?: SupplementaryConfig): Promise<LuminanceSection[]>;
/**
 * Detect constant luminance sections in video
 *
 * @param videoPath - Path to the video file
 * @param config - Detection configuration
 * @returns Array of constant luminance sections
 */
export declare function detectConstantLuminanceSections(videoPath: string, config?: SupplementaryConfig): Promise<LuminanceSection[]>;
/**
 * Detect motion/PAN sections using optical flow analysis
 *
 * @param videoPath - Path to the video file
 * @param config - Detection configuration
 * @returns Array of motion sections
 */
export declare function detectMotionSections(videoPath: string, config?: SupplementaryConfig): Promise<MotionSection[]>;
/**
 * Run all supplementary detection methods
 *
 * @param videoPath - Path to the video file
 * @param config - Detection configuration
 * @returns Combined detection results
 */
export declare function detectSupplementarySections(videoPath: string, config?: SupplementaryConfig): Promise<SupplementaryDetectionResult>;
/**
 * Merge TransNet V2 cuts with supplementary cuts
 *
 * @param transnetCuts - Cuts from TransNet V2
 * @param supplementaryCuts - Cuts from supplementary detection
 * @param deduplicationThreshold - Threshold for deduplication in seconds
 * @returns Merged and deduplicated cuts
 */
export declare function mergeWithTransNetCuts(transnetCuts: SceneCut[], supplementaryCuts: SceneCut[], deduplicationThreshold?: number): SceneCut[];
//# sourceMappingURL=supplementaryDetector.d.ts.map