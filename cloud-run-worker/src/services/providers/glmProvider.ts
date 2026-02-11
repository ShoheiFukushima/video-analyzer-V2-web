/**
 * GLM OCR Provider
 *
 * Implements OCR using ZhipuAI GLM-4V Vision API.
 * Excellent for Chinese and Japanese text recognition.
 *
 * @author Claude Code (Anthropic)
 * @since 2026-02-08
 */

import { OCRProvider, OCRResult, OCRProviderConfig, OCR_PROMPT } from '../ocrProviderInterface.js';

// ============================================================
// GLM Provider Implementation
// ============================================================

/**
 * GLM OCR Provider using GLM-4V vision model
 */
export class GLMOCRProvider extends OCRProvider {
  private readonly apiKey: string | null;
  private readonly modelName: string;
  private readonly baseUrl: string;

  constructor(config?: Partial<OCRProviderConfig>) {
    const apiKey = process.env.GLM_API_KEY || process.env.ZHIPU_API_KEY;
    const enabled = !!apiKey;

    const defaultConfig: OCRProviderConfig = {
      name: 'glm',
      maxParallel: parseInt(process.env.GLM_MAX_PARALLEL || '10', 10),
      rateLimit: parseInt(process.env.GLM_RATE_LIMIT || '100', 10),
      enabled,
      priority: 3,
      model: process.env.GLM_MODEL || 'glm-4v',
    };

    super({ ...defaultConfig, ...config });
    this.modelName = this.config.model || 'glm-4v';
    this.apiKey = apiKey || null;
    this.baseUrl = process.env.GLM_API_BASE || 'https://open.bigmodel.cn/api/paas/v4';

    if (apiKey) {
      console.log(
        `[GLMProvider] Initialized: model=${this.modelName}, ` +
          `maxParallel=${this.config.maxParallel}, rateLimit=${this.config.rateLimit}`
      );
    } else {
      console.warn('[GLMProvider] No GLM_API_KEY found, provider disabled');
    }
  }

  /**
   * Perform OCR using GLM-4V Vision
   */
  async performOCR(imageBuffer: Buffer): Promise<OCRResult> {
    if (!this.isAvailable() || !this.apiKey) {
      throw new Error('GLM provider is not available');
    }

    const startTime = Date.now();

    try {
      const result = await this.rateLimiter.executeWithRetry(
        async () => {
          const base64Image = imageBuffer.toString('base64');

          const response = await fetch(`${this.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify({
              model: this.modelName,
              messages: [
                {
                  role: 'user',
                  content: [
                    {
                      type: 'image_url',
                      image_url: {
                        url: `data:image/png;base64,${base64Image}`,
                      },
                    },
                    {
                      type: 'text',
                      text: OCR_PROMPT,
                    },
                  ],
                },
              ],
              max_tokens: 1024,
            }),
          });

          if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`GLM API error: ${response.status} - ${errorText}`);
          }

          const data = (await response.json()) as {
            choices: Array<{ message: { content: string } }>;
          };
          return data.choices[0]?.message?.content || '';
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
 * Create GLM OCR provider with environment configuration
 */
export function createGLMProvider(overrides?: Partial<OCRProviderConfig>): GLMOCRProvider | null {
  const apiKey = process.env.GLM_API_KEY || process.env.ZHIPU_API_KEY;
  if (!apiKey) {
    console.warn('[GLMProvider] Skipping creation - no API key');
    return null;
  }

  return new GLMOCRProvider(overrides);
}
