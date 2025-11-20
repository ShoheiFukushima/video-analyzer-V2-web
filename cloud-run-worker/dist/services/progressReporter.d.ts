/**
 * Progress Reporter for tracking processing status
 *
 * Manages progress updates to Supabase with threshold-based reporting
 * to avoid excessive database writes during parallel processing.
 *
 * @example
 * ```typescript
 * const reporter = new ProgressReporter(5); // Report every 5%
 * await reporter.report(uploadId, 65, 'ocr_processing');
 * ```
 */
import type { ProcessingStage } from '../types/shared.js';
export declare class ProgressReporter {
    private lastReportedProgress;
    private readonly threshold;
    private reportCount;
    private startTime;
    /**
     * Creates a new progress reporter
     * @param threshold - Minimum progress increment before reporting (default: 5%)
     */
    constructor(threshold?: number);
    /**
     * Reports progress if threshold is met
     * @param uploadId - Upload ID for the processing job
     * @param currentProgress - Current progress percentage (0-100)
     * @param stage - Current processing stage
     * @param message - Optional status message
     */
    report(uploadId: string, currentProgress: number, stage: ProcessingStage, message?: string): Promise<void>;
    /**
     * Forces an immediate progress update regardless of threshold
     * @param uploadId - Upload ID for the processing job
     * @param currentProgress - Current progress percentage (0-100)
     * @param stage - Current processing stage
     * @param message - Optional status message
     */
    forceReport(uploadId: string, currentProgress: number, stage: ProcessingStage, message?: string): Promise<void>;
    /**
     * Safe wrapper for status updates
     * @private
     */
    private safeUpdateStatus;
    /**
     * Gets reporter statistics
     */
    getStats(): {
        reportCount: number;
        elapsedTime: number;
        averageInterval: number;
    };
    /**
     * Resets the reporter state
     */
    reset(): void;
}
//# sourceMappingURL=progressReporter.d.ts.map