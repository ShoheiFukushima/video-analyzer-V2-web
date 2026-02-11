/**
 * OpenAI OCR Provider
 *
 * Implements OCR using OpenAI GPT-4 Vision API.
 * Fallback provider for when other providers are unavailable.
 *
 * @author Claude Code (Anthropic)
 * @since 2026-02-08
 */

import OpenAI from 'openai';
import { OCRProvider, OCRResult, OCRProviderConfig, OCR_PROMPT } from '../ocrProviderInterface.js';

// ============================================================
// OpenAI Provider Implementation
// ============================================================

/**
 * OpenAI OCR Provider
 */
export class OpenAIOCRProvider extends OCRProvider {
  private readonly client: OpenAI | null;
  private readonly modelName: string;

  constructor(config?: Partial<OCRProviderConfig>) {
    const apiKey = process.env.OPENAI_API_KEY;
    const enabled = !!apiKey;

    const defaultConfig: OCRProviderConfig = {
      name: 'openai',
      maxParallel: parseInt(process.env.OPENAI_MAX_PARALLEL || '10', 10),
      rateLimit: parseInt(process.env.OPENAI_RATE_LIMIT || '100', 10),
      enabled,
      priority: 4, // Fallback priority (after Gemini, Mistral, GLM)
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    };

    super({ ...defaultConfig, ...config });
    this.modelName = this.config.model || 'gpt-4o-mini';

    if (apiKey) {
      this.client = new OpenAI({ apiKey });
      console.log(
        `[OpenAIProvider] Initialized: model=${this.modelName}, ` +
          `maxParallel=${this.config.maxParallel}, rateLimit=${this.config.rateLimit}`
      );
    } else {
      this.client = null;
      console.warn('[OpenAIProvider] No OPENAI_API_KEY found, provider disabled');
    }
  }

  /**
   * Perform OCR using OpenAI Vision
   */
  async performOCR(imageBuffer: Buffer): Promise<OCRResult> {
    if (!this.isAvailable() || !this.client) {
      throw new Error('OpenAI provider is not available');
    }

    const startTime = Date.now();

    try {
      const result = await this.rateLimiter.executeWithRetry(
        async () => {
          const base64Image = imageBuffer.toString('base64');

          const response = await this.client!.chat.completions.create({
            model: this.modelName,
            max_tokens: 1024,
            messages: [
              {
                role: 'user',
                content: [
                  {
                    type: 'image_url',
                    image_url: {
                      url: `data:image/png;base64,${base64Image}`,
                      detail: 'high',
                    },
                  },
                  {
                    type: 'text',
                    text: OCR_PROMPT,
                  },
                ],
              },
            ],
          });

          return response.choices[0]?.message?.content || '';
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

      // Mark unavailable on rate limit or server errors
      if (
        errorMessage.includes('429') ||
        errorMessage.includes('rate') ||
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
 * Create OpenAI OCR provider with environment configuration
 */
export function createOpenAIProvider(
  overrides?: Partial<OCRProviderConfig>
): OpenAIOCRProvider | null {
  if (!process.env.OPENAI_API_KEY) {
    console.warn('[OpenAIProvider] Skipping creation - no API key');
    return null;
  }

  return new OpenAIOCRProvider(overrides);
}
