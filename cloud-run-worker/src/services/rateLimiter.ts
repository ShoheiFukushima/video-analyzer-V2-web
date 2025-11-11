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
export class RateLimiter {
  private lastRequestTime: number = 0;
  private readonly minInterval: number;
  private requestCount: number = 0;
  private windowStart: number = Date.now();

  /**
   * Creates a new rate limiter
   * @param requestsPerMinute - Maximum number of requests allowed per minute
   */
  constructor(requestsPerMinute: number) {
    // Calculate minimum interval between requests (in milliseconds)
    this.minInterval = (60 * 1000) / requestsPerMinute;
    console.log(`[RateLimiter] Initialized: ${requestsPerMinute} req/min (${this.minInterval}ms interval)`);
  }

  /**
   * Acquires permission to make a request.
   * Will wait if necessary to respect rate limits.
   */
  async acquire(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;

    // Check if we need to wait
    if (timeSinceLastRequest < this.minInterval) {
      const delay = this.minInterval - timeSinceLastRequest;
      console.log(`[RateLimiter] Rate limit: waiting ${delay}ms before next request`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }

    // Update tracking
    this.lastRequestTime = Date.now();
    this.requestCount++;

    // Log statistics every minute
    const windowDuration = Date.now() - this.windowStart;
    if (windowDuration > 60000) {
      console.log(`[RateLimiter] Stats: ${this.requestCount} requests in the last ${Math.round(windowDuration / 1000)}s`);
      this.requestCount = 0;
      this.windowStart = Date.now();
    }
  }

  /**
   * Gets current rate limiter statistics
   */
  getStats(): { requestCount: number; windowDuration: number } {
    return {
      requestCount: this.requestCount,
      windowDuration: Date.now() - this.windowStart
    };
  }
}