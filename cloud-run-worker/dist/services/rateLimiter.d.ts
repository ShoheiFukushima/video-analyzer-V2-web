/**
 * Rate Limiter for API Calls
 *
 * Provides semaphore-based concurrency control and sliding window rate limiting
 * for Gemini API and other external services.
 *
 * Features:
 * - Semaphore for concurrent request limiting
 * - Sliding window rate limiting
 * - Automatic retry with exponential backoff
 * - Singleton instance for Gemini API
 *
 * @author Claude Code (Anthropic)
 * @since 2026-01-17
 */
export interface RateLimiterConfig {
    /** Maximum concurrent requests */
    maxConcurrent: number;
    /** Maximum requests per window */
    maxRequestsPerWindow: number;
    /** Window duration in milliseconds */
    windowMs: number;
    /** Retry delay on rate limit in milliseconds */
    retryDelayMs: number;
    /** Maximum retry attempts */
    maxRetries: number;
}
export interface RateLimiterStats {
    currentConcurrent: number;
    requestsInWindow: number;
    windowStartTime: number;
    totalRequests: number;
    totalRateLimited: number;
    totalErrors: number;
}
/**
 * Simple semaphore for controlling concurrency
 */
export declare class Semaphore {
    private permits;
    private readonly maxPermits;
    private readonly waitQueue;
    constructor(maxPermits: number);
    /**
     * Acquire a permit, waiting if none are available
     */
    acquire(): Promise<void>;
    /**
     * Release a permit
     */
    release(): void;
    /**
     * Get current available permits
     */
    get available(): number;
    /**
     * Get number of waiters
     */
    get waiting(): number;
}
/**
 * Sliding window rate limiter
 */
export declare class SlidingWindowRateLimiter {
    private readonly windowMs;
    private readonly maxRequests;
    private requestTimestamps;
    constructor(maxRequests: number, windowMs: number);
    /**
     * Clean up old timestamps outside the window
     */
    private cleanup;
    /**
     * Check if a request can proceed
     */
    canProceed(): boolean;
    /**
     * Record a request
     */
    recordRequest(): void;
    /**
     * Calculate wait time until next request slot is available
     */
    getWaitTimeMs(): number;
    /**
     * Wait until a request slot is available
     */
    wait(): Promise<void>;
    /**
     * Get current request count in window
     */
    get requestCount(): number;
}
/**
 * Combined rate limiter with semaphore and sliding window
 */
export declare class RateLimiter {
    private readonly config;
    private readonly semaphore;
    private readonly slidingWindow;
    private stats;
    constructor(config?: Partial<RateLimiterConfig>);
    /**
     * Acquire rate limit slot (blocks until available)
     */
    acquire(): Promise<void>;
    /**
     * Release rate limit slot
     */
    release(): void;
    /**
     * Execute a function with rate limiting
     */
    execute<T>(fn: () => Promise<T>): Promise<T>;
    /**
     * Execute a function with rate limiting and retry
     */
    executeWithRetry<T>(fn: () => Promise<T>, isRetryable?: (error: unknown) => boolean): Promise<T>;
    /**
     * Get current statistics
     */
    getStats(): RateLimiterStats;
    /**
     * Log current status
     */
    logStatus(): void;
}
/**
 * Create Gemini API rate limiter
 * Default: 10 concurrent, 100 requests/minute
 */
export declare function createGeminiRateLimiter(): RateLimiter;
/**
 * Get or create the Gemini rate limiter singleton
 */
export declare function getGeminiRateLimiter(): RateLimiter;
/**
 * Reset the Gemini rate limiter (for testing)
 */
export declare function resetGeminiRateLimiter(): void;
/**
 * Check if an error is a rate limit error
 */
export declare function isRateLimitError(error: unknown): boolean;
/**
 * Check if an error is retryable
 */
export declare function isRetryableError(error: unknown): boolean;
/**
 * Simple rate limiter for backward compatibility
 * @deprecated Use RateLimiter class instead
 */
export declare class SimpleRateLimiter {
    private lastRequestTime;
    private readonly minInterval;
    private requestCount;
    private windowStart;
    constructor(requestsPerMinute: number);
    acquire(): Promise<void>;
    getStats(): {
        requestCount: number;
        windowDuration: number;
    };
}
//# sourceMappingURL=rateLimiter.d.ts.map