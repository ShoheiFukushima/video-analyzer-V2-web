/**
 * Alert Service for Developer Notifications
 *
 * Sends email alerts to developers when critical errors occur,
 * such as TransNet V2 failures or processing pipeline errors.
 *
 * Uses simple HTTPS requests to email services (no heavy dependencies).
 *
 * @author Claude Code (Anthropic)
 * @since 2026-01-17
 */
export interface AlertPayload {
    /** Alert title/subject */
    subject: string;
    /** Alert body (plain text or HTML) */
    body: string;
    /** Alert severity level */
    severity: 'info' | 'warning' | 'error' | 'critical';
    /** Additional metadata */
    metadata?: Record<string, unknown>;
}
export interface AlertContext {
    uploadId?: string;
    userId?: string;
    fileName?: string;
    stage?: string;
    error?: string;
    stackTrace?: string;
}
export interface AlertConfig {
    /** Developer email address */
    developerEmail: string;
    /** Service name for identification */
    serviceName: string;
    /** Enable/disable alerts */
    enabled: boolean;
    /** Webhook URL for alert delivery (optional) */
    webhookUrl?: string;
    /** Minimum severity to trigger alerts */
    minSeverity: AlertPayload['severity'];
}
/**
 * Load alert configuration from environment variables
 */
export declare function loadAlertConfig(): AlertConfig;
/**
 * Send an alert to developers
 *
 * @param payload - Alert payload
 * @param context - Alert context
 * @param config - Alert configuration (optional, uses env vars if not provided)
 */
export declare function sendAlert(payload: AlertPayload, context?: AlertContext, config?: AlertConfig): Promise<boolean>;
/**
 * Send TransNet V2 failure alert
 */
export declare function sendTransNetFailureAlert(error: string, context?: AlertContext): Promise<boolean>;
/**
 * Send processing pipeline failure alert
 */
export declare function sendPipelineFailureAlert(stage: string, error: string, context?: AlertContext): Promise<boolean>;
/**
 * Send rate limit warning alert
 */
export declare function sendRateLimitAlert(service: string, context?: AlertContext): Promise<boolean>;
/**
 * Send successful processing notification (for monitoring)
 */
export declare function sendProcessingSuccessAlert(stats: {
    totalScenes: number;
    processingTimeMs: number;
}, context?: AlertContext): Promise<boolean>;
/**
 * Send alert with throttling to prevent spam
 */
export declare function sendThrottledAlert(alertKey: string, payload: AlertPayload, context?: AlertContext): Promise<boolean>;
/**
 * Clear alert throttle state (for testing)
 */
export declare function clearAlertThrottle(): void;
//# sourceMappingURL=alertService.d.ts.map