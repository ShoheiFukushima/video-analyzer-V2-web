/**
 * Progress Tracker Service
 * Tracks frame extraction and OCR progress with throttled callbacks
 *
 * Created: 2026-02-06
 *
 * Features:
 * - Track progress for frame extraction and OCR processing
 * - Throttled callbacks to prevent excessive status updates
 * - Always reports 100% completion
 * - Generates subTask strings compatible with StatusManager
 */
import type { ProgressInfo, ProgressCallback, ProgressTrackerConfig, ProgressTracker } from '../types/progress.js';
export type { ProgressTracker, ProgressInfo, ProgressCallback, ProgressTrackerConfig };
/**
 * Create a progress tracker instance
 */
export declare function createProgressTracker(config: ProgressTrackerConfig): ProgressTracker;
/**
 * Create a progress callback that updates StatusManager
 * This is a factory function that creates a callback compatible with StatusManager
 */
export declare function createStatusUpdateCallback(uploadId: string, updatePhaseProgress: (uploadId: string, phase: 1 | 2 | 3, phaseProgress: number, options?: {
    subTask?: string;
    stage?: string;
}) => Promise<unknown>): ProgressCallback;
//# sourceMappingURL=progressTracker.d.ts.map