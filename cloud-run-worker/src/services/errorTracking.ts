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
export function logCriticalError(
  error: Error | unknown,
  context: ErrorContext
): void {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const errorStack = error instanceof Error ? error.stack : undefined;

  // Structured logging for Cloud Monitoring
  const logEntry = {
    severity: 'ERROR',
    message: 'CRITICAL_ERROR',
    error: {
      message: errorMessage,
      stack: errorStack,
      name: error instanceof Error ? error.name : 'UnknownError',
    },
    context,
    timestamp: new Date().toISOString(),
  };

  // Log as JSON for Cloud Logging structured logs
  console.error(JSON.stringify(logEntry));

  // Also log in human-readable format for development
  if (process.env.NODE_ENV !== 'production') {
    console.error('[CRITICAL ERROR]', errorMessage);
    console.error('Context:', context);
    if (errorStack) {
      console.error('Stack:', errorStack);
    }
  }
}

/**
 * Log a warning that should be monitored
 *
 * @param message - Warning message
 * @param context - Additional context
 */
export function logWarning(message: string, context: ErrorContext): void {
  const logEntry = {
    severity: 'WARNING',
    message: `WARNING: ${message}`,
    context,
    timestamp: new Date().toISOString(),
  };

  console.warn(JSON.stringify(logEntry));

  if (process.env.NODE_ENV !== 'production') {
    console.warn('[WARNING]', message);
    console.warn('Context:', context);
  }
}
