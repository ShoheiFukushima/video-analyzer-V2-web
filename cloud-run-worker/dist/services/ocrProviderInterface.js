/**
 * OCR Provider Interface
 *
 * Defines the common interface for all OCR providers (Gemini, Claude, OpenAI).
 * Enables multi-provider OCR processing with fallback and load distribution.
 *
 * @author Claude Code (Anthropic)
 * @since 2026-02-08
 */
import { RateLimiter } from './rateLimiter.js';
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
export class OCRProvider {
    constructor(config) {
        this._isAvailable = true;
        this.unavailableUntil = 0;
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
    get name() {
        return this.config.name;
    }
    /**
     * Get provider priority
     */
    get priority() {
        return this.config.priority;
    }
    /**
     * Check if provider is enabled
     */
    get enabled() {
        return this.config.enabled;
    }
    /**
     * Check if provider is currently available
     */
    isAvailable() {
        if (!this.config.enabled)
            return false;
        if (!this._isAvailable && Date.now() < this.unavailableUntil)
            return false;
        // Reset availability after cooldown
        if (!this._isAvailable && Date.now() >= this.unavailableUntil) {
            this._isAvailable = true;
        }
        return this._isAvailable;
    }
    /**
     * Mark provider as temporarily unavailable
     * @param durationMs - Cooldown duration in milliseconds
     */
    markUnavailable(durationMs = 30000) {
        this._isAvailable = false;
        this.unavailableUntil = Date.now() + durationMs;
        this.stats.isAvailable = false;
        console.warn(`[${this.name}] Marked as unavailable for ${durationMs}ms`);
    }
    /**
     * Get provider statistics
     */
    getStats() {
        return { ...this.stats, isAvailable: this.isAvailable() };
    }
    /**
     * Update statistics after a request
     */
    updateStats(success, processingTimeMs, error) {
        this.stats.totalRequests++;
        if (success) {
            this.stats.successfulRequests++;
            // Update average processing time (exponential moving average)
            if (this.stats.avgProcessingTimeMs === 0) {
                this.stats.avgProcessingTimeMs = processingTimeMs;
            }
            else {
                this.stats.avgProcessingTimeMs =
                    this.stats.avgProcessingTimeMs * 0.9 + processingTimeMs * 0.1;
            }
        }
        else {
            this.stats.failedRequests++;
            this.stats.lastError = error;
            this.stats.lastErrorTime = Date.now();
        }
        this.stats.isAvailable = this.isAvailable();
    }
    /**
     * Get the rate limiter for this provider
     */
    getRateLimiter() {
        return this.rateLimiter;
    }
    /**
     * Parse JSON response from provider
     */
    parseOCRResponse(responseText) {
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
        }
        catch {
            // Try natural language extraction
            const extractedText = this.extractTextFromNaturalLanguage(responseText);
            return { text: extractedText, confidence: extractedText ? 0.5 : 0 };
        }
    }
    /**
     * Extract text from natural language response
     */
    extractTextFromNaturalLanguage(response) {
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
    isRetryableError(error) {
        const message = error.message.toLowerCase();
        return (message.includes('503') ||
            message.includes('429') ||
            message.includes('overloaded') ||
            message.includes('rate limit') ||
            message.includes('timeout') ||
            message.includes('network'));
    }
}
//# sourceMappingURL=ocrProviderInterface.js.map