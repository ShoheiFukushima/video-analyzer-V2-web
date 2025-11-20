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
import { updateStatus } from './statusManager.js';
export class ProgressReporter {
    /**
     * Creates a new progress reporter
     * @param threshold - Minimum progress increment before reporting (default: 5%)
     */
    constructor(threshold = 5) {
        this.lastReportedProgress = 0;
        this.reportCount = 0;
        this.startTime = Date.now();
        this.threshold = threshold;
        console.log(`[ProgressReporter] Initialized with ${threshold}% reporting threshold`);
    }
    /**
     * Reports progress if threshold is met
     * @param uploadId - Upload ID for the processing job
     * @param currentProgress - Current progress percentage (0-100)
     * @param stage - Current processing stage
     * @param message - Optional status message
     */
    async report(uploadId, currentProgress, stage, message) {
        // Only report if progress increased by threshold amount
        if (currentProgress - this.lastReportedProgress >= this.threshold) {
            try {
                const updates = {
                    progress: Math.min(100, Math.floor(currentProgress)),
                    stage
                };
                // Add message if provided
                if (message) {
                    updates.message = message;
                }
                // Safe update with error handling
                await this.safeUpdateStatus(uploadId, updates);
                // Update tracking
                this.lastReportedProgress = currentProgress;
                this.reportCount++;
                // Log progress
                console.log(`[ProgressReporter] Progress: ${currentProgress}% - ${stage}` +
                    (message ? ` - ${message}` : ''));
            }
            catch (error) {
                // Non-fatal error - don't interrupt processing
                console.warn(`[ProgressReporter] Failed to update progress (non-fatal):`, error);
            }
        }
    }
    /**
     * Forces an immediate progress update regardless of threshold
     * @param uploadId - Upload ID for the processing job
     * @param currentProgress - Current progress percentage (0-100)
     * @param stage - Current processing stage
     * @param message - Optional status message
     */
    async forceReport(uploadId, currentProgress, stage, message) {
        const originalThreshold = this.lastReportedProgress;
        this.lastReportedProgress = currentProgress - this.threshold; // Trick to force update
        await this.report(uploadId, currentProgress, stage, message);
        // Restore if report failed
        if (this.lastReportedProgress < currentProgress) {
            this.lastReportedProgress = originalThreshold;
        }
    }
    /**
     * Safe wrapper for status updates
     * @private
     */
    async safeUpdateStatus(uploadId, updates) {
        try {
            await updateStatus(uploadId, updates);
        }
        catch (error) {
            // Log but don't throw - progress updates are non-critical
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.warn(`[ProgressReporter] Status update failed for ${uploadId}: ${errorMessage}`);
            // In development, continue anyway
            if (process.env.NODE_ENV === 'development') {
                console.log('[ProgressReporter] Continuing despite status update failure (dev mode)');
            }
        }
    }
    /**
     * Gets reporter statistics
     */
    getStats() {
        const elapsedTime = Date.now() - this.startTime;
        return {
            reportCount: this.reportCount,
            elapsedTime,
            averageInterval: this.reportCount > 0 ? elapsedTime / this.reportCount : 0
        };
    }
    /**
     * Resets the reporter state
     */
    reset() {
        this.lastReportedProgress = 0;
        this.reportCount = 0;
        this.startTime = Date.now();
        console.log('[ProgressReporter] State reset');
    }
}
//# sourceMappingURL=progressReporter.js.map