/**
 * Gemini OCR Provider
 *
 * Implements OCR using Google Gemini Vision API.
 * Primary provider for video subtitle extraction.
 *
 * @author Claude Code (Anthropic)
 * @since 2026-02-08
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { OCRProvider, OCRResult, OCRProviderConfig, OCR_PROMPT } from '../ocrProviderInterface.js';
import { extractRetryAfter } from '../rateLimiter.js';

// ============================================================
// Error Classification
// ============================================================

export type OCRErrorCategory = 'rate_limit' | 'auth' | 'network' | 'server' | 'unknown';

/**
 * Extract detailed error information from Gemini SDK errors
 * Gemini SDK wraps HTTP errors in GoogleGenerativeAIError with nested structures
 */
export function classifyGeminiError(error: unknown): {
  category: OCRErrorCategory;
  status?: number;
  code?: string;
  detail: string;
} {
  const err = error as Record<string, any>;
  const message = err?.message || String(error);
  const status = err?.status ?? err?.response?.status ?? err?.errorDetails?.[0]?.httpStatusCode;
  const code = err?.code ?? err?.errorDetails?.[0]?.reason;

  if (status === 429 || message.includes('429') || message.includes('RESOURCE_EXHAUSTED') ||
      message.includes('rate limit') || message.includes('quota')) {
    return { category: 'rate_limit', status, code, detail: message };
  }
  if (status === 401 || status === 403 || message.includes('API_KEY_INVALID') ||
      message.includes('PERMISSION_DENIED') || message.includes('insufficient_quota')) {
    return { category: 'auth', status, code, detail: message };
  }
  if (message.includes('ECONNRESET') || message.includes('ETIMEDOUT') ||
      message.includes('ENOTFOUND') || message.includes('network') ||
      message.includes('socket') || message.includes('fetch failed')) {
    return { category: 'network', status, code, detail: message };
  }
  if (status === 500 || status === 502 || status === 503 || status === 504) {
    return { category: 'server', status, code, detail: message };
  }

  return { category: 'unknown', status, code, detail: message };
}

// ============================================================
// Gemini Provider Implementation
// ============================================================

/**
 * Gemini OCR Provider
 */
export class GeminiOCRProvider extends OCRProvider {
  private readonly genAI: GoogleGenerativeAI;
  private readonly modelName: string;

  constructor(config?: Partial<OCRProviderConfig>) {
    const apiKey = process.env.GEMINI_API_KEY;
    const enabled = !!apiKey;

    const defaultConfig: OCRProviderConfig = {
      name: 'gemini',
      maxParallel: parseInt(process.env.GEMINI_MAX_PARALLEL || '10', 10),
      rateLimit: parseInt(process.env.GEMINI_RATE_LIMIT || '100', 10),
      enabled,
      priority: 1,
      model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    };

    super({ ...defaultConfig, ...config });
    this.modelName = this.config.model || 'gemini-2.5-flash';

    if (apiKey) {
      this.genAI = new GoogleGenerativeAI(apiKey);
      console.log(
        `[GeminiProvider] Initialized: model=${this.modelName}, ` +
          `maxParallel=${this.config.maxParallel}, rateLimit=${this.config.rateLimit}`
      );
    } else {
      this.genAI = null as unknown as GoogleGenerativeAI;
      console.warn('[GeminiProvider] No GEMINI_API_KEY found, provider disabled');
    }
  }

  /**
   * Perform OCR using Gemini Vision
   */
  async performOCR(imageBuffer: Buffer): Promise<OCRResult> {
    if (!this.isAvailable()) {
      throw new Error('Gemini provider is not available');
    }

    const startTime = Date.now();

    try {
      const result = await this.rateLimiter.executeWithRetry(
        async () => {
          const model = this.genAI.getGenerativeModel({ model: this.modelName });
          const base64Image = imageBuffer.toString('base64');

          const response = await model.generateContent([
            OCR_PROMPT,
            { inlineData: { mimeType: 'image/png', data: base64Image } },
          ]);

          return response.response.text();
        },
        (error) => this.isRetryableError(error as Error)
      );

      const parsed = this.parseOCRResponse(result);
      const processingTimeMs = Date.now() - startTime;

      this.updateStats(true, processingTimeMs);

      return {
        text: parsed.text,
        confidence: parsed.confidence,
        provider: this.name,
        processingTimeMs,
      };
    } catch (error) {
      const processingTimeMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);
      const classified = classifyGeminiError(error);

      console.error(
        `[GeminiProvider] OCR failed: category=${classified.category}, ` +
          `status=${classified.status ?? 'N/A'}, code=${classified.code ?? 'N/A'}, ` +
          `detail=${classified.detail.slice(0, 200)}`
      );

      this.updateStats(false, processingTimeMs, errorMessage);

      // Mark unavailable on repeated failures with adaptive cooldown
      if (
        classified.category === 'rate_limit' ||
        classified.category === 'server' ||
        classified.category === 'auth'
      ) {
        const retryAfterMs = extractRetryAfter(error) ?? undefined;
        this.markUnavailable(retryAfterMs);
      }

      throw error;
    }
  }
}

// ============================================================
// Factory Function
// ============================================================

/**
 * Create Gemini OCR provider with environment configuration
 */
export function createGeminiProvider(
  overrides?: Partial<OCRProviderConfig>
): GeminiOCRProvider | null {
  if (!process.env.GEMINI_API_KEY) {
    console.warn('[GeminiProvider] Skipping creation - no API key');
    return null;
  }

  return new GeminiOCRProvider(overrides);
}
