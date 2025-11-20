/**
 * Rate Limiter for API calls
 *
 * Ensures API calls respect rate limits by enforcing minimum intervals
 * between requests. Essential for Gemini Vision API (15 requests/min).
 *
 * @example
 * ```typescript
 * const limiter = new RateLimiter(15); // 15 requests per minute
 * await limiter.acquire(); // Wait if necessary
 * await makeAPICall();
 * ```
 */
export declare class RateLimiter {
    private lastRequestTime;
    private readonly minInterval;
    private requestCount;
    private windowStart;
    /**
     * Creates a new rate limiter
     * @param requestsPerMinute - Maximum number of requests allowed per minute
     */
    constructor(requestsPerMinute: number);
    /**
     * Acquires permission to make a request.
     * Will wait if necessary to respect rate limits.
     */
    acquire(): Promise<void>;
    /**
     * Gets current rate limiter statistics
     */
    getStats(): {
        requestCount: number;
        windowDuration: number;
    };
}
//# sourceMappingURL=rateLimiter.d.ts.map