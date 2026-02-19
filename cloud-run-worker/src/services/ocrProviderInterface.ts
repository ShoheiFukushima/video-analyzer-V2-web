/**
 * OCR Provider Interface
 *
 * Defines the common interface for all OCR providers (Gemini, Claude, OpenAI).
 * Enables multi-provider OCR processing with fallback and load distribution.
 *
 * @author Claude Code (Anthropic)
 * @since 2026-02-08
 */

import { RateLimiter, extractRetryAfter } from './rateLimiter.js';

// ============================================================
// Types and Interfaces
// ============================================================

/**
 * OCR result from any provider
 */
export interface OCRResult {
  /** Extracted text */
  text: string;
  /** Confidence score (0-1) */
  confidence: number;
  /** Provider name that processed this result */
  provider: string;
  /** Processing time in milliseconds */
  processingTimeMs?: number;
}

/**
 * OCR provider configuration
 */
export interface OCRProviderConfig {
  /** Provider name */
  name: string;
  /** Maximum parallel requests */
  maxParallel: number;
  /** Rate limit (requests per minute) */
  rateLimit: number;
  /** Whether this provider is enabled */
  enabled: boolean;
  /** Priority (lower = higher priority) */
  priority: number;
  /** Model to use */
  model?: string;
}

/**
 * OCR provider statistics
 */
export interface OCRProviderStats {
  /** Total requests made */
  totalRequests: number;
  /** Successful requests */
  successfulRequests: number;
  /** Failed requests */
  failedRequests: number;
  /** Average processing time in ms */
  avgProcessingTimeMs: number;
  /** Current availability status */
  isAvailable: boolean;
  /** Last error message */
  lastError?: string;
  /** Last error timestamp */
  lastErrorTime?: number;
}

/**
 * Common OCR prompt for video subtitle extraction
 * Shared across all providers for consistent results
 */
export const OCR_PROMPT = `You are an OCR system specialized for VIDEO SUBTITLES and CAPTIONS.

IMPORTANT: Focus ONLY on PRIMARY TEXT (subtitles, captions, main titles).
IGNORE background text, small product labels, logos, watermarks.

OUTPUT FORMAT:
Return ONLY a valid JSON object (no markdown, no additional text):
{
  "text": "extracted text (use \\n for line breaks)",
  "confidence": 0.95
}

PRIORITY ORDER (extract in this order):
1. **HIGHEST**: Subtitles/Captions in bottom 20% of screen (largest, most important)
2. **HIGH**: Main titles in center of screen (large, prominent)
3. **MEDIUM**: On-screen text overlays (medium size)
4. **IGNORE**: Small text (height < 3% of screen height)
5. **IGNORE**: Background text (signs, posters, product labels, logos)
6. **IGNORE**: Watermarks, copyright notices

TEXT SIZE RULES:
- Extract text ONLY if its height is at least 3% of screen height
- If text is too small or blurry, IGNORE it
- Focus on LARGE, CLEAR text that viewers are meant to read

REGION OF INTEREST:
- Prioritize bottom 20% of screen (subtitle area)
- Prioritize center 30% of screen (title area)
- Deprioritize edges and corners

SUPPORTED LANGUAGES:
- Japanese (kanji: 漢字, hiragana: ひらがな, katakana: カタカナ)
- English (A-Z, a-z)
- Numbers and symbols

IF NO PRIMARY TEXT (subtitles/titles) IS VISIBLE:
- Return: {"text": "", "confidence": 0}
- Do NOT extract background text just because "all text" was requested

CONFIDENCE SCORE:
- 0.9-1.0: Very clear primary text, high certainty
- 0.7-0.9: Readable primary text, medium certainty
- 0.5-0.7: Partially obscured primary text
- 0.0-0.5: Very unclear or no primary text

EXAMPLE GOOD OUTPUT:
{"text": "今日の天気は晴れ\\nToday's weather is sunny", "confidence": 0.92}

EXAMPLE BAD OUTPUT (DO NOT DO THIS):
{"text": "会社ロゴ\\n製品名ABC\\n©2023 Company\\n小さな注意書き\\nポスターの文字", "confidence": 0.85}`;

// ============================================================
// Abstract OCR Provider
// ============================================================

/**
 * Abstract base class for OCR providers
 */
/** Cooldown schedule for consecutive failures (30s → 1m → 2m → 5m) */
const COOLDOWN_SCHEDULE_MS = [30000, 60000, 120000, 300000];

export abstract class OCRProvider {
  protected readonly config: OCRProviderConfig;
  protected readonly rateLimiter: RateLimiter;
  protected stats: OCRProviderStats;
  protected _isAvailable: boolean = true;
  protected unavailableUntil: number = 0;
  protected consecutiveFailures: number = 0;

  constructor(config: OCRProviderConfig) {
    this.config = config;
    this.rateLimiter = new RateLimiter({
      maxConcurrent: config.maxParallel,
      maxRequestsPerWindow: config.rateLimit,
      windowMs: 60000,
      retryDelayMs: 1000,
      maxRetries: 3,
    });
    this.stats = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      avgProcessingTimeMs: 0,
      isAvailable: true,
    };
  }

  /**
   * Get provider name
   */
  get name(): string {
    return this.config.name;
  }

  /**
   * Get provider priority
   */
  get priority(): number {
    return this.config.priority;
  }

  /**
   * Check if provider is enabled
   */
  get enabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Check if provider is currently available
   */
  isAvailable(): boolean {
    if (!this.config.enabled) return false;
    if (!this._isAvailable && Date.now() < this.unavailableUntil) return false;

    // Reset availability after cooldown
    if (!this._isAvailable && Date.now() >= this.unavailableUntil) {
      this._isAvailable = true;
    }

    return this._isAvailable;
  }

  /**
   * Mark provider as temporarily unavailable with adaptive cooldown
   * @param retryAfterMs - Optional Retry-After value from server (overrides schedule if larger)
   */
  protected markUnavailable(retryAfterMs?: number): void {
    this.consecutiveFailures++;
    const scheduleIndex = Math.min(this.consecutiveFailures - 1, COOLDOWN_SCHEDULE_MS.length - 1);
    const scheduledCooldown = COOLDOWN_SCHEDULE_MS[scheduleIndex];
    const durationMs = retryAfterMs ? Math.max(retryAfterMs, scheduledCooldown) : scheduledCooldown;

    this._isAvailable = false;
    this.unavailableUntil = Date.now() + durationMs;
    this.stats.isAvailable = false;
    console.warn(`[${this.name}] Marked as unavailable for ${durationMs}ms (consecutive failures: ${this.consecutiveFailures})`);
  }

  /**
   * Get provider statistics
   */
  getStats(): OCRProviderStats {
    return { ...this.stats, isAvailable: this.isAvailable() };
  }

  /**
   * Update statistics after a request
   */
  protected updateStats(success: boolean, processingTimeMs: number, error?: string): void {
    this.stats.totalRequests++;
    if (success) {
      this.stats.successfulRequests++;
      this.consecutiveFailures = 0; // Reset on success
      // Update average processing time (exponential moving average)
      if (this.stats.avgProcessingTimeMs === 0) {
        this.stats.avgProcessingTimeMs = processingTimeMs;
      } else {
        this.stats.avgProcessingTimeMs =
          this.stats.avgProcessingTimeMs * 0.9 + processingTimeMs * 0.1;
      }
    } else {
      this.stats.failedRequests++;
      this.stats.lastError = error;
      this.stats.lastErrorTime = Date.now();
    }
    this.stats.isAvailable = this.isAvailable();
  }

  /**
   * Perform OCR on an image
   * @param imageBuffer - Image data as Buffer
   * @returns OCR result
   */
  abstract performOCR(imageBuffer: Buffer): Promise<OCRResult>;

  /**
   * Get the rate limiter for this provider
   */
  getRateLimiter(): RateLimiter {
    return this.rateLimiter;
  }

  /**
   * Parse JSON response from provider
   */
  protected parseOCRResponse(responseText: string): { text: string; confidence: number } {
    try {
      // Remove markdown code blocks if present
      const jsonText = responseText.replace(/```json\n?|\n?```/g, '').trim();
      const parsed = JSON.parse(jsonText);

      if (typeof parsed.text !== 'string') {
        throw new Error('Missing or invalid "text" field');
      }
      if (typeof parsed.confidence !== 'number' || parsed.confidence < 0 || parsed.confidence > 1) {
        parsed.confidence = 0.5;
      }

      return { text: parsed.text, confidence: parsed.confidence };
    } catch {
      // Try natural language extraction
      const extractedText = this.extractTextFromNaturalLanguage(responseText);
      return { text: extractedText, confidence: extractedText ? 0.5 : 0 };
    }
  }

  /**
   * Extract text from natural language response
   */
  protected extractTextFromNaturalLanguage(response: string): string {
    const patterns = [
      /contains[:\s]+["']([^"']+)["']/gi,
      /shows[:\s]+["']([^"']+)["']/gi,
      /text[:\s]+["']([^"']+)["']/gi,
      /says[:\s]+["']([^"']+)["']/gi,
      /reads[:\s]+["']([^"']+)["']/gi,
      /displays[:\s]+["']([^"']+)["']/gi,
    ];

    for (const pattern of patterns) {
      const matches = [...response.matchAll(pattern)];
      if (matches.length > 0 && matches[0][1]) {
        return matches[0][1].trim();
      }
    }

    // Pattern 2: Text enclosed in Japanese or English quotes
    const quotedPattern = /[「『"']([^」』"']{3,})[」』"']/g;
    const quotedMatches = [...response.matchAll(quotedPattern)];
    if (quotedMatches.length > 0) {
      return quotedMatches.map((m) => m[1]).join('\n');
    }

    return '';
  }

  /**
   * Check if error is retryable
   */
  protected isRetryableError(error: Error): boolean {
    const message = error.message.toLowerCase();
    return (
      message.includes('503') ||
      message.includes('429') ||
      message.includes('overloaded') ||
      message.includes('rate limit') ||
      message.includes('timeout') ||
      message.includes('network')
    );
  }
}
