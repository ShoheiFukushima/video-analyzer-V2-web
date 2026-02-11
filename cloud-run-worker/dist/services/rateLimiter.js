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
// ============================================================
// Semaphore Implementation
// ============================================================
/**
 * Simple semaphore for controlling concurrency
 */
export class Semaphore {
    constructor(maxPermits) {
        this.waitQueue = [];
        this.maxPermits = maxPermits;
        this.permits = maxPermits;
    }
    /**
     * Acquire a permit, waiting if none are available
     */
    async acquire() {
        if (this.permits > 0) {
            this.permits--;
            return;
        }
        return new Promise((resolve) => {
            this.waitQueue.push(resolve);
        });
    }
    /**
     * Release a permit
     */
    release() {
        if (this.waitQueue.length > 0) {
            const next = this.waitQueue.shift();
            if (next)
                next();
        }
        else {
            this.permits = Math.min(this.permits + 1, this.maxPermits);
        }
    }
    /**
     * Get current available permits
     */
    get available() {
        return this.permits;
    }
    /**
     * Get number of waiters
     */
    get waiting() {
        return this.waitQueue.length;
    }
}
// ============================================================
// Sliding Window Rate Limiter
// ============================================================
/**
 * Sliding window rate limiter
 */
export class SlidingWindowRateLimiter {
    constructor(maxRequests, windowMs) {
        this.requestTimestamps = [];
        this.maxRequests = maxRequests;
        this.windowMs = windowMs;
    }
    /**
     * Clean up old timestamps outside the window
     */
    cleanup() {
        const now = Date.now();
        const windowStart = now - this.windowMs;
        this.requestTimestamps = this.requestTimestamps.filter((ts) => ts > windowStart);
    }
    /**
     * Check if a request can proceed
     */
    canProceed() {
        this.cleanup();
        return this.requestTimestamps.length < this.maxRequests;
    }
    /**
     * Record a request
     */
    recordRequest() {
        this.requestTimestamps.push(Date.now());
    }
    /**
     * Calculate wait time until next request slot is available
     */
    getWaitTimeMs() {
        this.cleanup();
        if (this.requestTimestamps.length < this.maxRequests) {
            return 0;
        }
        const oldestTimestamp = this.requestTimestamps[0];
        const waitTime = oldestTimestamp + this.windowMs - Date.now();
        return Math.max(0, waitTime);
    }
    /**
     * Wait until a request slot is available
     */
    async wait() {
        const waitTime = this.getWaitTimeMs();
        if (waitTime > 0) {
            await new Promise((resolve) => setTimeout(resolve, waitTime));
        }
        this.recordRequest();
    }
    /**
     * Get current request count in window
     */
    get requestCount() {
        this.cleanup();
        return this.requestTimestamps.length;
    }
}
// ============================================================
// Combined Rate Limiter
// ============================================================
const DEFAULT_CONFIG = {
    maxConcurrent: 10,
    maxRequestsPerWindow: 100,
    windowMs: 60000, // 1 minute
    retryDelayMs: 1000,
    maxRetries: 3,
};
/**
 * Combined rate limiter with semaphore and sliding window
 */
export class RateLimiter {
    constructor(config = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.semaphore = new Semaphore(this.config.maxConcurrent);
        this.slidingWindow = new SlidingWindowRateLimiter(this.config.maxRequestsPerWindow, this.config.windowMs);
        this.stats = {
            currentConcurrent: 0,
            requestsInWindow: 0,
            windowStartTime: Date.now(),
            totalRequests: 0,
            totalRateLimited: 0,
            totalErrors: 0,
        };
        console.log(`[RateLimiter] Initialized: ${this.config.maxConcurrent} concurrent, ` +
            `${this.config.maxRequestsPerWindow} req/${this.config.windowMs / 1000}s`);
    }
    /**
     * Acquire rate limit slot (blocks until available)
     */
    async acquire() {
        // First, wait for sliding window slot
        const waitTime = this.slidingWindow.getWaitTimeMs();
        if (waitTime > 0) {
            console.log(`[RateLimiter] Waiting ${waitTime}ms for rate limit window`);
            this.stats.totalRateLimited++;
            await new Promise((resolve) => setTimeout(resolve, waitTime));
        }
        // Then, acquire semaphore
        await this.semaphore.acquire();
        this.slidingWindow.recordRequest();
        this.stats.currentConcurrent++;
        this.stats.totalRequests++;
        this.stats.requestsInWindow = this.slidingWindow.requestCount;
    }
    /**
     * Release rate limit slot
     */
    release() {
        this.semaphore.release();
        this.stats.currentConcurrent--;
    }
    /**
     * Execute a function with rate limiting
     */
    async execute(fn) {
        await this.acquire();
        try {
            return await fn();
        }
        catch (error) {
            this.stats.totalErrors++;
            throw error;
        }
        finally {
            this.release();
        }
    }
    /**
     * Execute a function with rate limiting and retry
     */
    async executeWithRetry(fn, isRetryable = () => true) {
        let lastError;
        for (let attempt = 0; attempt < this.config.maxRetries; attempt++) {
            try {
                return await this.execute(fn);
            }
            catch (error) {
                lastError = error;
                if (!isRetryable(error) || attempt >= this.config.maxRetries - 1) {
                    throw error;
                }
                const delay = this.config.retryDelayMs * Math.pow(2, attempt);
                console.log(`[RateLimiter] Retry ${attempt + 1}/${this.config.maxRetries} after ${delay}ms`);
                await new Promise((resolve) => setTimeout(resolve, delay));
            }
        }
        throw lastError;
    }
    /**
     * Get current statistics
     */
    getStats() {
        return {
            ...this.stats,
            requestsInWindow: this.slidingWindow.requestCount,
        };
    }
    /**
     * Log current status
     */
    logStatus() {
        const stats = this.getStats();
        console.log(`[RateLimiter] Status: concurrent=${stats.currentConcurrent}/${this.config.maxConcurrent}, ` +
            `window=${stats.requestsInWindow}/${this.config.maxRequestsPerWindow}, ` +
            `total=${stats.totalRequests}, rateLimited=${stats.totalRateLimited}, errors=${stats.totalErrors}`);
    }
}
// ============================================================
// Pre-configured Rate Limiters
// ============================================================
/**
 * Create Gemini API rate limiter
 * Default: 10 concurrent, 100 requests/minute
 */
export function createGeminiRateLimiter() {
    const maxConcurrent = parseInt(process.env.GEMINI_MAX_PARALLEL || '10', 10);
    const maxRequestsPerWindow = parseInt(process.env.GEMINI_RATE_LIMIT || '100', 10);
    console.log(`[RateLimiter] Creating Gemini rate limiter: ${maxConcurrent} concurrent, ${maxRequestsPerWindow} req/min`);
    return new RateLimiter({
        maxConcurrent,
        maxRequestsPerWindow,
        windowMs: 60000,
        retryDelayMs: 1000,
        maxRetries: 3,
    });
}
// ============================================================
// Singleton Instance
// ============================================================
let geminiRateLimiter = null;
/**
 * Get or create the Gemini rate limiter singleton
 */
export function getGeminiRateLimiter() {
    if (!geminiRateLimiter) {
        geminiRateLimiter = createGeminiRateLimiter();
    }
    return geminiRateLimiter;
}
/**
 * Reset the Gemini rate limiter (for testing)
 */
export function resetGeminiRateLimiter() {
    geminiRateLimiter = null;
}
// ============================================================
// Utility Functions
// ============================================================
/**
 * Check if an error is a rate limit error
 */
export function isRateLimitError(error) {
    if (error instanceof Error) {
        const message = error.message.toLowerCase();
        return (message.includes('rate limit') ||
            message.includes('429') ||
            message.includes('too many requests') ||
            message.includes('quota exceeded'));
    }
    return false;
}
/**
 * Check if an error is retryable
 */
export function isRetryableError(error) {
    if (error instanceof Error) {
        const message = error.message.toLowerCase();
        return (isRateLimitError(error) ||
            message.includes('timeout') ||
            message.includes('network') ||
            message.includes('econnreset') ||
            message.includes('econnrefused') ||
            message.includes('503') ||
            message.includes('502') ||
            message.includes('500'));
    }
    return false;
}
// ============================================================
// Legacy Compatibility (Simple Rate Limiter)
// ============================================================
/**
 * Simple rate limiter for backward compatibility
 * @deprecated Use RateLimiter class instead
 */
export class SimpleRateLimiter {
    constructor(requestsPerMinute) {
        this.lastRequestTime = 0;
        this.requestCount = 0;
        this.windowStart = Date.now();
        this.minInterval = (60 * 1000) / requestsPerMinute;
        console.log(`[SimpleRateLimiter] Initialized: ${requestsPerMinute} req/min (${this.minInterval}ms interval)`);
    }
    async acquire() {
        const now = Date.now();
        const timeSinceLastRequest = now - this.lastRequestTime;
        if (timeSinceLastRequest < this.minInterval) {
            const delay = this.minInterval - timeSinceLastRequest;
            console.log(`[SimpleRateLimiter] Rate limit: waiting ${delay}ms before next request`);
            await new Promise((resolve) => setTimeout(resolve, delay));
        }
        this.lastRequestTime = Date.now();
        this.requestCount++;
        const windowDuration = Date.now() - this.windowStart;
        if (windowDuration > 60000) {
            console.log(`[SimpleRateLimiter] Stats: ${this.requestCount} requests in the last ${Math.round(windowDuration / 1000)}s`);
            this.requestCount = 0;
            this.windowStart = Date.now();
        }
    }
    getStats() {
        return {
            requestCount: this.requestCount,
            windowDuration: Date.now() - this.windowStart,
        };
    }
}
//# sourceMappingURL=rateLimiter.js.map