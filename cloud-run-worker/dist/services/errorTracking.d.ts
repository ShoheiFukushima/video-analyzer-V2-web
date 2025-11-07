/**
 * Error Tracking Service
 *
 * Provides structured error logging for Cloud Monitoring.
 * Critical errors are logged with special formatting for alerting.
 */
export interface ErrorContext {
    uploadId?: string;
    blobUrl?: string;
    operation?: string;
    stage?: string;
    [key: string]: unknown;
}
/**
 * Log a critical error with structured data for Cloud Monitoring
 *
 * This function outputs errors in a format that can be easily
 * detected by Cloud Monitoring log-based metrics and alerts.
 *
 * @param error - The error object
 * @param context - Additional context about the error
 */
export declare function logCriticalError(error: Error | unknown, context: ErrorContext): void;
/**
 * Log a warning that should be monitored
 *
 * @param message - Warning message
 * @param context - Additional context
 */
export declare function logWarning(message: string, context: ErrorContext): void;
//# sourceMappingURL=errorTracking.d.ts.map