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
export declare const OCR_PROMPT = "You are an OCR system specialized for VIDEO SUBTITLES and CAPTIONS.\n\nIMPORTANT: Focus ONLY on PRIMARY TEXT (subtitles, captions, main titles).\nIGNORE background text, small product labels, logos, watermarks.\n\nOUTPUT FORMAT:\nReturn ONLY a valid JSON object (no markdown, no additional text):\n{\n  \"text\": \"extracted text (use \\n for line breaks)\",\n  \"confidence\": 0.95\n}\n\nPRIORITY ORDER (extract in this order):\n1. **HIGHEST**: Subtitles/Captions in bottom 20% of screen (largest, most important)\n2. **HIGH**: Main titles in center of screen (large, prominent)\n3. **MEDIUM**: On-screen text overlays (medium size)\n4. **IGNORE**: Small text (height < 3% of screen height)\n5. **IGNORE**: Background text (signs, posters, product labels, logos)\n6. **IGNORE**: Watermarks, copyright notices\n\nTEXT SIZE RULES:\n- Extract text ONLY if its height is at least 3% of screen height\n- If text is too small or blurry, IGNORE it\n- Focus on LARGE, CLEAR text that viewers are meant to read\n\nREGION OF INTEREST:\n- Prioritize bottom 20% of screen (subtitle area)\n- Prioritize center 30% of screen (title area)\n- Deprioritize edges and corners\n\nSUPPORTED LANGUAGES:\n- Japanese (kanji: \u6F22\u5B57, hiragana: \u3072\u3089\u304C\u306A, katakana: \u30AB\u30BF\u30AB\u30CA)\n- English (A-Z, a-z)\n- Numbers and symbols\n\nIF NO PRIMARY TEXT (subtitles/titles) IS VISIBLE:\n- Return: {\"text\": \"\", \"confidence\": 0}\n- Do NOT extract background text just because \"all text\" was requested\n\nCONFIDENCE SCORE:\n- 0.9-1.0: Very clear primary text, high certainty\n- 0.7-0.9: Readable primary text, medium certainty\n- 0.5-0.7: Partially obscured primary text\n- 0.0-0.5: Very unclear or no primary text\n\nEXAMPLE GOOD OUTPUT:\n{\"text\": \"\u4ECA\u65E5\u306E\u5929\u6C17\u306F\u6674\u308C\\nToday's weather is sunny\", \"confidence\": 0.92}\n\nEXAMPLE BAD OUTPUT (DO NOT DO THIS):\n{\"text\": \"\u4F1A\u793E\u30ED\u30B4\\n\u88FD\u54C1\u540DABC\\n\u00A92023 Company\\n\u5C0F\u3055\u306A\u6CE8\u610F\u66F8\u304D\\n\u30DD\u30B9\u30BF\u30FC\u306E\u6587\u5B57\", \"confidence\": 0.85}";
/**
 * Abstract base class for OCR providers
 */
export declare abstract class OCRProvider {
    protected readonly config: OCRProviderConfig;
    protected readonly rateLimiter: RateLimiter;
    protected stats: OCRProviderStats;
    protected _isAvailable: boolean;
    protected unavailableUntil: number;
    constructor(config: OCRProviderConfig);
    /**
     * Get provider name
     */
    get name(): string;
    /**
     * Get provider priority
     */
    get priority(): number;
    /**
     * Check if provider is enabled
     */
    get enabled(): boolean;
    /**
     * Check if provider is currently available
     */
    isAvailable(): boolean;
    /**
     * Mark provider as temporarily unavailable
     * @param durationMs - Cooldown duration in milliseconds
     */
    protected markUnavailable(durationMs?: number): void;
    /**
     * Get provider statistics
     */
    getStats(): OCRProviderStats;
    /**
     * Update statistics after a request
     */
    protected updateStats(success: boolean, processingTimeMs: number, error?: string): void;
    /**
     * Perform OCR on an image
     * @param imageBuffer - Image data as Buffer
     * @returns OCR result
     */
    abstract performOCR(imageBuffer: Buffer): Promise<OCRResult>;
    /**
     * Get the rate limiter for this provider
     */
    getRateLimiter(): RateLimiter;
    /**
     * Parse JSON response from provider
     */
    protected parseOCRResponse(responseText: string): {
        text: string;
        confidence: number;
    };
    /**
     * Extract text from natural language response
     */
    protected extractTextFromNaturalLanguage(response: string): string;
    /**
     * Check if error is retryable
     */
    protected isRetryableError(error: Error): boolean;
}
//# sourceMappingURL=ocrProviderInterface.d.ts.map