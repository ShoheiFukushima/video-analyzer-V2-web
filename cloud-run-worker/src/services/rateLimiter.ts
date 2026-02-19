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
// Types and Interfaces
// ============================================================

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
  /** Jitter factor for backoff randomization (0-1, default: 0.5) */
  jitterFactor?: number;
}

export interface RateLimiterStats {
  currentConcurrent: number;
  requestsInWindow: number;
  windowStartTime: number;
  totalRequests: number;
  totalRateLimited: number;
  totalErrors: number;
}

// ============================================================
// Semaphore Implementation
// ============================================================

/**
 * Simple semaphore for controlling concurrency
 */
export class Semaphore {
  private permits: number;
  private readonly maxPermits: number;
  private readonly waitQueue: Array<() => void> = [];

  constructor(maxPermits: number) {
    this.maxPermits = maxPermits;
    this.permits = maxPermits;
  }

  /**
   * Acquire a permit, waiting if none are available
   */
  async acquire(): Promise<void> {
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
  release(): void {
    if (this.waitQueue.length > 0) {
      const next = this.waitQueue.shift();
      if (next) next();
    } else {
      this.permits = Math.min(this.permits + 1, this.maxPermits);
    }
  }

  /**
   * Get current available permits
   */
  get available(): number {
    return this.permits;
  }

  /**
   * Get number of waiters
   */
  get waiting(): number {
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
  private readonly windowMs: number;
  private readonly maxRequests: number;
  private readonly minIntervalMs: number;
  private requestTimestamps: number[] = [];
  private lastRequestTime: number = 0;

  constructor(maxRequests: number, windowMs: number) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
    // Minimum interval between requests to smooth out bursts
    this.minIntervalMs = Math.floor(windowMs / maxRequests);
  }

  /**
   * Clean up old timestamps outside the window
   */
  private cleanup(): void {
    const now = Date.now();
    const windowStart = now - this.windowMs;
    this.requestTimestamps = this.requestTimestamps.filter((ts) => ts > windowStart);
  }

  /**
   * Check if a request can proceed
   */
  canProceed(): boolean {
    this.cleanup();
    return this.requestTimestamps.length < this.maxRequests;
  }

  /**
   * Record a request
   */
  recordRequest(): void {
    this.requestTimestamps.push(Date.now());
  }

  /**
   * Calculate wait time until next request slot is available
   */
  getWaitTimeMs(): number {
    this.cleanup();

    if (this.requestTimestamps.length < this.maxRequests) {
      return 0;
    }

    const oldestTimestamp = this.requestTimestamps[0];
    const waitTime = oldestTimestamp + this.windowMs - Date.now();
    return Math.max(0, waitTime);
  }

  /**
   * Wait until a request slot is available, with request smoothing
   */
  async wait(): Promise<void> {
    // Enforce minimum interval between requests (smoothing)
    const timeSinceLastRequest = Date.now() - this.lastRequestTime;
    if (this.lastRequestTime > 0 && timeSinceLastRequest < this.minIntervalMs) {
      const smoothingDelay = this.minIntervalMs - timeSinceLastRequest;
      await new Promise((resolve) => setTimeout(resolve, smoothingDelay));
    }

    // Wait for sliding window slot
    const waitTime = this.getWaitTimeMs();
    if (waitTime > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }
    this.recordRequest();
    this.lastRequestTime = Date.now();
  }

  /**
   * Get current request count in window
   */
  get requestCount(): number {
    this.cleanup();
    return this.requestTimestamps.length;
  }
}

// ============================================================
// Combined Rate Limiter
// ============================================================

const DEFAULT_CONFIG: RateLimiterConfig = {
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
  private readonly config: RateLimiterConfig;
  private readonly semaphore: Semaphore;
  private readonly slidingWindow: SlidingWindowRateLimiter;
  private stats: RateLimiterStats;

  constructor(config: Partial<RateLimiterConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.semaphore = new Semaphore(this.config.maxConcurrent);
    this.slidingWindow = new SlidingWindowRateLimiter(
      this.config.maxRequestsPerWindow,
      this.config.windowMs
    );
    this.stats = {
      currentConcurrent: 0,
      requestsInWindow: 0,
      windowStartTime: Date.now(),
      totalRequests: 0,
      totalRateLimited: 0,
      totalErrors: 0,
    };

    console.log(
      `[RateLimiter] Initialized: ${this.config.maxConcurrent} concurrent, ` +
      `${this.config.maxRequestsPerWindow} req/${this.config.windowMs / 1000}s`
    );
  }

  /**
   * Acquire rate limit slot (blocks until available)
   */
  async acquire(): Promise<void> {
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
  release(): void {
    this.semaphore.release();
    this.stats.currentConcurrent--;
  }

  /**
   * Execute a function with rate limiting
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } catch (error) {
      this.stats.totalErrors++;
      throw error;
    } finally {
      this.release();
    }
  }

  /**
   * Execute a function with rate limiting and retry
   */
  async executeWithRetry<T>(
    fn: () => Promise<T>,
    isRetryable: (error: unknown) => boolean = () => true
  ): Promise<T> {
    let lastError: unknown;

    for (let attempt = 0; attempt < this.config.maxRetries; attempt++) {
      try {
        return await this.execute(fn);
      } catch (error) {
        lastError = error;

        if (!isRetryable(error) || attempt >= this.config.maxRetries - 1) {
          throw error;
        }

        const base = this.config.retryDelayMs * Math.pow(2, attempt);
        const jitterFactor = this.config.jitterFactor ?? 0.5;
        const jitter = base * jitterFactor * Math.random();
        let delay = Math.round(base + jitter);

        // Respect Retry-After header if present
        const retryAfterMs = extractRetryAfter(error);
        if (retryAfterMs !== null && retryAfterMs > delay) {
          console.log(`[RateLimiter] Retry-After header: ${retryAfterMs}ms (overriding calculated ${delay}ms)`);
          delay = retryAfterMs;
        }

        console.log(`[RateLimiter] Retry ${attempt + 1}/${this.config.maxRetries} after ${delay}ms (base=${base}, jitter=${Math.round(jitter)})`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    throw lastError;
  }

  /**
   * Get current statistics
   */
  getStats(): RateLimiterStats {
    return {
      ...this.stats,
      requestsInWindow: this.slidingWindow.requestCount,
    };
  }

  /**
   * Log current status
   */
  logStatus(): void {
    const stats = this.getStats();
    console.log(
      `[RateLimiter] Status: concurrent=${stats.currentConcurrent}/${this.config.maxConcurrent}, ` +
      `window=${stats.requestsInWindow}/${this.config.maxRequestsPerWindow}, ` +
      `total=${stats.totalRequests}, rateLimited=${stats.totalRateLimited}, errors=${stats.totalErrors}`
    );
  }
}

// ============================================================
// Pre-configured Rate Limiters
// ============================================================

/**
 * Create Gemini API rate limiter
 * Default: 10 concurrent, 100 requests/minute
 */
export function createGeminiRateLimiter(): RateLimiter {
  const maxConcurrent = parseInt(process.env.GEMINI_MAX_PARALLEL || '10', 10);
  const maxRequestsPerWindow = parseInt(process.env.GEMINI_RATE_LIMIT || '100', 10);

  console.log(`[RateLimiter] Creating Gemini rate limiter: ${maxConcurrent} concurrent, ${maxRequestsPerWindow} req/min`);

  return new RateLimiter({
    maxConcurrent,
    maxRequestsPerWindow,
    windowMs: 60000,
    retryDelayMs: 1000,
    maxRetries: 5,
    jitterFactor: 0.5,
  });
}

// ============================================================
// Singleton Instance
// ============================================================

let geminiRateLimiter: RateLimiter | null = null;

/**
 * Get or create the Gemini rate limiter singleton
 */
export function getGeminiRateLimiter(): RateLimiter {
  if (!geminiRateLimiter) {
    geminiRateLimiter = createGeminiRateLimiter();
  }
  return geminiRateLimiter;
}

/**
 * Reset the Gemini rate limiter (for testing)
 */
export function resetGeminiRateLimiter(): void {
  geminiRateLimiter = null;
}

// ============================================================
// Whisper Rate Limiter
// ============================================================

/**
 * Create Whisper API rate limiter
 * Default: 5 concurrent, 50 requests/minute
 */
export function createWhisperRateLimiter(): RateLimiter {
  const maxConcurrent = parseInt(process.env.WHISPER_MAX_PARALLEL || '5', 10);
  const maxRequestsPerWindow = parseInt(process.env.WHISPER_RATE_LIMIT || '50', 10);

  console.log(`[RateLimiter] Creating Whisper rate limiter: ${maxConcurrent} concurrent, ${maxRequestsPerWindow} req/min`);

  return new RateLimiter({
    maxConcurrent,
    maxRequestsPerWindow,
    windowMs: 60000,
    retryDelayMs: 1000,
    maxRetries: 5,
    jitterFactor: 0.5,
  });
}

let whisperRateLimiter: RateLimiter | null = null;

/**
 * Get or create the Whisper rate limiter singleton
 */
export function getWhisperRateLimiter(): RateLimiter {
  if (!whisperRateLimiter) {
    whisperRateLimiter = createWhisperRateLimiter();
  }
  return whisperRateLimiter;
}

/**
 * Reset the Whisper rate limiter (for testing)
 */
export function resetWhisperRateLimiter(): void {
  whisperRateLimiter = null;
}

// ============================================================
// Utility Functions
// ============================================================

/**
 * Extract Retry-After value from error response headers
 * Supports both seconds (numeric) and HTTP-date formats
 *
 * @param error - Error object (may contain response headers)
 * @returns Retry-after delay in milliseconds, or null if not present
 */
export function extractRetryAfter(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null;

  const err = error as Record<string, any>;

  // Check for Retry-After header in response
  const retryAfterHeader =
    err.response?.headers?.['retry-after'] ??
    err.response?.headers?.get?.('retry-after');

  if (retryAfterHeader) {
    const seconds = Number(retryAfterHeader);
    if (!isNaN(seconds)) {
      return seconds * 1000; // Convert seconds to ms
    }
    // Try HTTP-date format
    const date = new Date(retryAfterHeader);
    if (!isNaN(date.getTime())) {
      return Math.max(0, date.getTime() - Date.now());
    }
  }

  // Check for Google SDK retryDelay format
  if (typeof err.retryDelay === 'number') {
    return err.retryDelay;
  }

  return null;
}

/**
 * Check if an error is a rate limit error
 */
export function isRateLimitError(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return (
      message.includes('rate limit') ||
      message.includes('429') ||
      message.includes('too many requests') ||
      message.includes('quota exceeded')
    );
  }
  return false;
}

/**
 * Check if an error is retryable
 */
export function isRetryableError(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return (
      isRateLimitError(error) ||
      message.includes('timeout') ||
      message.includes('network') ||
      message.includes('econnreset') ||
      message.includes('econnrefused') ||
      message.includes('503') ||
      message.includes('502') ||
      message.includes('500')
    );
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
  private lastRequestTime: number = 0;
  private readonly minInterval: number;
  private requestCount: number = 0;
  private windowStart: number = Date.now();

  constructor(requestsPerMinute: number) {
    this.minInterval = (60 * 1000) / requestsPerMinute;
    console.log(`[SimpleRateLimiter] Initialized: ${requestsPerMinute} req/min (${this.minInterval}ms interval)`);
  }

  async acquire(): Promise<void> {
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

  getStats(): { requestCount: number; windowDuration: number } {
    return {
      requestCount: this.requestCount,
      windowDuration: Date.now() - this.windowStart,
    };
  }
}
