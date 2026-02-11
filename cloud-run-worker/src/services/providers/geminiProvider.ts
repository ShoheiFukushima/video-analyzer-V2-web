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

      this.updateStats(false, processingTimeMs, errorMessage);

      // Mark unavailable on repeated failures
      if (
        errorMessage.includes('503') ||
        errorMessage.includes('429') ||
        errorMessage.includes('quota')
      ) {
        this.markUnavailable(60000); // 1 minute cooldown
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
