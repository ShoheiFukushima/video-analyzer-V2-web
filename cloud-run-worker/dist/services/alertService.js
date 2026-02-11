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
import https from 'https';
import http from 'http';
// ============================================================
// Configuration
// ============================================================
const SEVERITY_LEVELS = {
    info: 0,
    warning: 1,
    error: 2,
    critical: 3,
};
/**
 * Load alert configuration from environment variables
 */
export function loadAlertConfig() {
    return {
        developerEmail: process.env.DEVELOPER_ALERT_EMAIL || 'syou430@gmail.com',
        serviceName: process.env.SERVICE_NAME || 'video-analyzer-worker',
        enabled: process.env.ALERTS_ENABLED !== 'false',
        webhookUrl: process.env.ALERT_WEBHOOK_URL,
        minSeverity: process.env.ALERT_MIN_SEVERITY || 'error',
    };
}
// ============================================================
// Alert Formatting
// ============================================================
/**
 * Format alert as plain text
 */
function formatPlainTextAlert(payload, context, config) {
    const timestamp = new Date().toISOString();
    const lines = [
        `=== ${config.serviceName.toUpperCase()} ALERT ===`,
        `Severity: ${payload.severity.toUpperCase()}`,
        `Time: ${timestamp}`,
        `Subject: ${payload.subject}`,
        '',
        '--- Details ---',
        payload.body,
    ];
    if (context.uploadId)
        lines.push(`Upload ID: ${context.uploadId}`);
    if (context.userId)
        lines.push(`User ID: ${context.userId}`);
    if (context.fileName)
        lines.push(`File: ${context.fileName}`);
    if (context.stage)
        lines.push(`Stage: ${context.stage}`);
    if (context.error)
        lines.push(`Error: ${context.error}`);
    if (context.stackTrace) {
        lines.push('', '--- Stack Trace ---', context.stackTrace);
    }
    if (payload.metadata && Object.keys(payload.metadata).length > 0) {
        lines.push('', '--- Metadata ---', JSON.stringify(payload.metadata, null, 2));
    }
    return lines.join('\n');
}
/**
 * Format alert as HTML
 */
function formatHtmlAlert(payload, context, config) {
    const timestamp = new Date().toISOString();
    const severityColor = {
        info: '#2196F3',
        warning: '#FF9800',
        error: '#F44336',
        critical: '#9C27B0',
    }[payload.severity];
    return `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .header { background: ${severityColor}; color: white; padding: 16px; border-radius: 4px 4px 0 0; }
    .content { padding: 16px; background: #f5f5f5; }
    .section { margin-bottom: 16px; }
    .label { font-weight: bold; color: #666; }
    .value { margin-left: 8px; }
    .error { color: #F44336; }
    pre { background: #263238; color: #fff; padding: 12px; border-radius: 4px; overflow-x: auto; }
    .metadata { background: #fff; padding: 12px; border: 1px solid #ddd; border-radius: 4px; }
  </style>
</head>
<body>
  <div class="header">
    <h2 style="margin: 0;">${config.serviceName.toUpperCase()} Alert</h2>
    <p style="margin: 8px 0 0 0; opacity: 0.9;">${payload.severity.toUpperCase()} - ${timestamp}</p>
  </div>
  <div class="content">
    <div class="section">
      <h3>${payload.subject}</h3>
      <p>${payload.body.replace(/\n/g, '<br>')}</p>
    </div>

    ${context.uploadId ? `<div class="section"><span class="label">Upload ID:</span><span class="value">${context.uploadId}</span></div>` : ''}
    ${context.userId ? `<div class="section"><span class="label">User ID:</span><span class="value">${context.userId}</span></div>` : ''}
    ${context.fileName ? `<div class="section"><span class="label">File:</span><span class="value">${context.fileName}</span></div>` : ''}
    ${context.stage ? `<div class="section"><span class="label">Stage:</span><span class="value">${context.stage}</span></div>` : ''}
    ${context.error ? `<div class="section"><span class="label">Error:</span><span class="value error">${context.error}</span></div>` : ''}

    ${context.stackTrace ? `
    <div class="section">
      <span class="label">Stack Trace:</span>
      <pre>${context.stackTrace}</pre>
    </div>
    ` : ''}

    ${payload.metadata && Object.keys(payload.metadata).length > 0 ? `
    <div class="section">
      <span class="label">Metadata:</span>
      <div class="metadata"><pre>${JSON.stringify(payload.metadata, null, 2)}</pre></div>
    </div>
    ` : ''}
  </div>
</body>
</html>
  `.trim();
}
// ============================================================
// Alert Delivery
// ============================================================
/**
 * Send alert via webhook (Slack, Discord, etc.)
 */
async function sendWebhookAlert(webhookUrl, payload, context, config) {
    return new Promise((resolve) => {
        try {
            const url = new URL(webhookUrl);
            const isSlack = webhookUrl.includes('slack.com');
            const isDiscord = webhookUrl.includes('discord.com');
            let body;
            if (isSlack) {
                body = JSON.stringify({
                    text: `[${payload.severity.toUpperCase()}] ${payload.subject}`,
                    blocks: [
                        {
                            type: 'header',
                            text: { type: 'plain_text', text: `🚨 ${config.serviceName} Alert` },
                        },
                        {
                            type: 'section',
                            fields: [
                                { type: 'mrkdwn', text: `*Severity:*\n${payload.severity}` },
                                { type: 'mrkdwn', text: `*Time:*\n${new Date().toISOString()}` },
                            ],
                        },
                        {
                            type: 'section',
                            text: { type: 'mrkdwn', text: `*${payload.subject}*\n${payload.body}` },
                        },
                        ...(context.uploadId
                            ? [{ type: 'section', text: { type: 'mrkdwn', text: `*Upload ID:* ${context.uploadId}` } }]
                            : []),
                        ...(context.error
                            ? [{ type: 'section', text: { type: 'mrkdwn', text: `*Error:* \`${context.error}\`` } }]
                            : []),
                    ],
                });
            }
            else if (isDiscord) {
                body = JSON.stringify({
                    content: `**[${payload.severity.toUpperCase()}]** ${payload.subject}`,
                    embeds: [
                        {
                            title: `${config.serviceName} Alert`,
                            description: payload.body,
                            color: { info: 0x2196f3, warning: 0xff9800, error: 0xf44336, critical: 0x9c27b0 }[payload.severity],
                            fields: [
                                ...(context.uploadId ? [{ name: 'Upload ID', value: context.uploadId, inline: true }] : []),
                                ...(context.error ? [{ name: 'Error', value: context.error, inline: false }] : []),
                            ],
                            timestamp: new Date().toISOString(),
                        },
                    ],
                });
            }
            else {
                // Generic webhook
                body = JSON.stringify({
                    subject: payload.subject,
                    body: payload.body,
                    severity: payload.severity,
                    context,
                    timestamp: new Date().toISOString(),
                });
            }
            const options = {
                hostname: url.hostname,
                port: url.port || (url.protocol === 'https:' ? 443 : 80),
                path: url.pathname + url.search,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(body),
                },
            };
            const transport = url.protocol === 'https:' ? https : http;
            const req = transport.request(options, (res) => {
                resolve(res.statusCode === 200 || res.statusCode === 204);
            });
            req.on('error', (error) => {
                console.error('[AlertService] Webhook error:', error.message);
                resolve(false);
            });
            req.write(body);
            req.end();
        }
        catch (error) {
            console.error('[AlertService] Webhook error:', error);
            resolve(false);
        }
    });
}
/**
 * Log alert to console (fallback when no delivery method available)
 */
function logAlertToConsole(payload, context, config) {
    const text = formatPlainTextAlert(payload, context, config);
    switch (payload.severity) {
        case 'info':
            console.info('[AlertService]', text);
            break;
        case 'warning':
            console.warn('[AlertService]', text);
            break;
        case 'error':
        case 'critical':
            console.error('[AlertService]', text);
            break;
    }
}
// ============================================================
// Main Alert Functions
// ============================================================
/**
 * Send an alert to developers
 *
 * @param payload - Alert payload
 * @param context - Alert context
 * @param config - Alert configuration (optional, uses env vars if not provided)
 */
export async function sendAlert(payload, context = {}, config = loadAlertConfig()) {
    // Check if alerts are enabled
    if (!config.enabled) {
        console.log('[AlertService] Alerts disabled, skipping');
        return false;
    }
    // Check severity threshold
    if (SEVERITY_LEVELS[payload.severity] < SEVERITY_LEVELS[config.minSeverity]) {
        console.log(`[AlertService] Severity ${payload.severity} below threshold ${config.minSeverity}, skipping`);
        return false;
    }
    console.log(`[AlertService] Sending ${payload.severity} alert: ${payload.subject}`);
    // Try webhook delivery
    if (config.webhookUrl) {
        const webhookSuccess = await sendWebhookAlert(config.webhookUrl, payload, context, config);
        if (webhookSuccess) {
            console.log('[AlertService] Alert sent via webhook');
            return true;
        }
        console.warn('[AlertService] Webhook delivery failed, falling back to console');
    }
    // Fallback to console logging
    logAlertToConsole(payload, context, config);
    return true;
}
// ============================================================
// Pre-defined Alert Functions
// ============================================================
/**
 * Send TransNet V2 failure alert
 */
export async function sendTransNetFailureAlert(error, context = {}) {
    return sendAlert({
        subject: 'TransNet V2 Scene Detection Failed',
        body: `TransNet V2 processing failed. The system has fallen back to FFmpeg detection.\n\nError: ${error}`,
        severity: 'error',
        metadata: {
            fallbackUsed: true,
            detectionMethod: 'ffmpeg',
        },
    }, context);
}
/**
 * Send processing pipeline failure alert
 */
export async function sendPipelineFailureAlert(stage, error, context = {}) {
    return sendAlert({
        subject: `Pipeline Failed at Stage: ${stage}`,
        body: `Video processing pipeline encountered a fatal error.\n\nStage: ${stage}\nError: ${error}`,
        severity: 'critical',
        metadata: {
            stage,
            recoverable: false,
        },
    }, { ...context, stage });
}
/**
 * Send rate limit warning alert
 */
export async function sendRateLimitAlert(service, context = {}) {
    return sendAlert({
        subject: `Rate Limit Hit: ${service}`,
        body: `The ${service} API rate limit was exceeded. Requests are being throttled.`,
        severity: 'warning',
        metadata: {
            service,
            action: 'throttling',
        },
    }, context);
}
/**
 * Send successful processing notification (for monitoring)
 */
export async function sendProcessingSuccessAlert(stats, context = {}) {
    return sendAlert({
        subject: 'Video Processing Completed',
        body: `Successfully processed video.\n\nScenes detected: ${stats.totalScenes}\nProcessing time: ${(stats.processingTimeMs / 1000).toFixed(1)}s`,
        severity: 'info',
        metadata: stats,
    }, context);
}
const recentAlerts = new Map();
const AGGREGATION_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const MAX_ALERTS_PER_WINDOW = 5;
/**
 * Check if alert should be throttled (prevent spam)
 */
function shouldThrottleAlert(alertKey) {
    const now = Date.now();
    const record = recentAlerts.get(alertKey);
    if (!record) {
        recentAlerts.set(alertKey, { count: 1, firstSeen: now, lastSeen: now });
        return false;
    }
    // Reset if outside window
    if (now - record.firstSeen > AGGREGATION_WINDOW_MS) {
        recentAlerts.set(alertKey, { count: 1, firstSeen: now, lastSeen: now });
        return false;
    }
    // Update record
    record.count++;
    record.lastSeen = now;
    // Throttle if exceeded limit
    if (record.count > MAX_ALERTS_PER_WINDOW) {
        return true;
    }
    return false;
}
/**
 * Send alert with throttling to prevent spam
 */
export async function sendThrottledAlert(alertKey, payload, context = {}) {
    if (shouldThrottleAlert(alertKey)) {
        console.log(`[AlertService] Alert throttled (key: ${alertKey})`);
        return false;
    }
    return sendAlert(payload, context);
}
/**
 * Clear alert throttle state (for testing)
 */
export function clearAlertThrottle() {
    recentAlerts.clear();
}
//# sourceMappingURL=alertService.js.map