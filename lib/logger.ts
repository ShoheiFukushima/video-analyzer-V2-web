/**
 * Logging utility for API request/response tracking and debugging
 */

import { NextRequest } from 'next/server';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogContext {
  requestId?: string;
  userId?: string | null;
  method?: string;
  path?: string;
  statusCode?: number;
  duration?: number;
  error?: any;
  [key: string]: any;
}

class Logger {
  private isDevelopment = process.env.NODE_ENV === 'development';
  private isProduction = process.env.NODE_ENV === 'production';

  private formatMessage(level: LogLevel, message: string, context?: LogContext): string {
    const timestamp = new Date().toISOString();
    const requestId = context?.requestId || 'no-request-id';

    // Structured logging format for production
    if (this.isProduction) {
      return JSON.stringify({
        timestamp,
        level,
        message,
        requestId,
        ...context,
      });
    }

    // Human-readable format for development
    const prefix = `[${timestamp}] [${level.toUpperCase()}] [${requestId}]`;
    const contextStr = context ? ` ${JSON.stringify(context, null, 2)}` : '';
    return `${prefix} ${message}${contextStr}`;
  }

  private log(level: LogLevel, message: string, context?: LogContext) {
    const formattedMessage = this.formatMessage(level, message, context);

    switch (level) {
      case 'debug':
        if (this.isDevelopment) console.debug(formattedMessage);
        break;
      case 'info':
        console.log(formattedMessage);
        break;
      case 'warn':
        console.warn(formattedMessage);
        break;
      case 'error':
        console.error(formattedMessage);
        break;
    }
  }

  debug(message: string, context?: LogContext) {
    this.log('debug', message, context);
  }

  info(message: string, context?: LogContext) {
    this.log('info', message, context);
  }

  warn(message: string, context?: LogContext) {
    this.log('warn', message, context);
  }

  error(message: string, context?: LogContext) {
    this.log('error', message, context);
  }

  // Log API request
  logRequest(req: NextRequest, context?: LogContext) {
    const url = new URL(req.url);
    this.info('API Request', {
      method: req.method,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      headers: this.sanitizeHeaders(req.headers),
      ...context,
    });
  }

  // Log API response
  logResponse(req: NextRequest, statusCode: number, duration: number, context?: LogContext) {
    const url = new URL(req.url);
    const level = statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'info';

    this.log(level as LogLevel, 'API Response', {
      method: req.method,
      path: url.pathname,
      statusCode,
      duration,
      durationMs: `${duration}ms`,
      ...context,
    });
  }

  // Log errors with stack traces
  logError(error: any, context?: LogContext) {
    const errorInfo = {
      message: error.message || 'Unknown error',
      stack: this.isDevelopment ? error.stack : undefined,
      name: error.name,
      ...context,
    };

    this.error('Error occurred', errorInfo);
  }

  // Sanitize sensitive headers
  private sanitizeHeaders(headers: Headers): Record<string, string> {
    const sanitized: Record<string, string> = {};
    const sensitiveHeaders = ['authorization', 'cookie', 'x-api-key', 'x-auth-token'];

    headers.forEach((value, key) => {
      if (sensitiveHeaders.includes(key.toLowerCase())) {
        sanitized[key] = '[REDACTED]';
      } else {
        sanitized[key] = value;
      }
    });

    return sanitized;
  }

  // Generate unique request ID
  generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // Create a child logger with context
  child(context: LogContext): Logger {
    const childLogger = new Logger();
    const originalLog = childLogger.log.bind(childLogger);

    childLogger.log = (level: LogLevel, message: string, ctx?: LogContext) => {
      originalLog(level, message, { ...context, ...ctx });
    };

    return childLogger;
  }
}

// Singleton instance
export const logger = new Logger();

// Middleware helper for timing API routes
export function withLogging<T>(
  handler: (req: NextRequest, context: any) => Promise<T>
) {
  return async (req: NextRequest, context: any): Promise<T> => {
    const startTime = Date.now();
    const requestId = logger.generateRequestId();

    // Log incoming request
    logger.logRequest(req, { requestId });

    try {
      const result = await handler(req, context);

      // Log successful response
      const duration = Date.now() - startTime;
      logger.logResponse(req, 200, duration, { requestId });

      return result;
    } catch (error) {
      // Log error
      const duration = Date.now() - startTime;
      logger.logError(error, { requestId, duration, durationMs: `${duration}ms` });

      throw error;
    }
  };
}

// Performance monitoring
export class PerformanceMonitor {
  private markers: Map<string, number> = new Map();

  mark(name: string) {
    this.markers.set(name, Date.now());
    logger.debug(`Performance mark: ${name}`);
  }

  measure(name: string, startMark: string, endMark?: string): number {
    const start = this.markers.get(startMark);
    const end = endMark ? this.markers.get(endMark) : Date.now();

    if (!start) {
      logger.warn(`Start mark '${startMark}' not found`);
      return 0;
    }

    const duration = (end || Date.now()) - start;
    logger.info(`Performance measure: ${name}`, { duration, durationMs: `${duration}ms` });

    return duration;
  }

  clear() {
    this.markers.clear();
  }
}