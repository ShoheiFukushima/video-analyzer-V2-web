/**
 * PySceneDetect Detector
 *
 * Node.js wrapper for PySceneDetect ContentDetector + DissolveDetector Python script.
 * Follows the same spawn pattern as transnetDetector.ts.
 *
 * ContentDetector: Detects hard cuts (abrupt scene changes)
 * DissolveDetector: Detects gradual transitions (dissolves, cross-fades) via skip-frame comparison
 *
 * @since 2026-02-18
 */
import type { SceneCut } from '../types/excel.js';
import type { SceneDetectionProgressCallback } from './ffmpeg.js';
export interface TelopAnimation {
    region: string;
    start: number;
    settling: number;
}
export interface PanAnimation {
    start: number;
    settling: number;
    direction: 'horizontal' | 'vertical' | 'diagonal';
}
/**
 * Detect scene cuts using PySceneDetect ContentDetector + optional DissolveDetector
 *
 * @param videoPath - Path to the video file
 * @param videoDuration - Video duration in seconds (for progress estimation)
 * @param onProgress - Optional progress callback
 * @returns Object with scene cuts array
 */
export declare function detectWithPyScene(videoPath: string, videoDuration?: number, onProgress?: SceneDetectionProgressCallback): Promise<{
    cuts: SceneCut[];
    telopAnimations: TelopAnimation[];
    panAnimations: PanAnimation[];
}>;
//# sourceMappingURL=pysceneDetector.d.ts.map