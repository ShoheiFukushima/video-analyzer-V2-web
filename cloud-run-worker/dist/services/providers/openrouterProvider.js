/**
 * OpenRouter OCR Provider
 *
 * Uses OpenRouter (OpenAI-compatible API) to access multiple vision models
 * as a universal fallback for OCR processing.
 *
 * Supported models (via OpenRouter):
 * - google/gemini-2.0-flash-001 (default, fast & cheap)
 * - anthropic/claude-sonnet-4 (high quality)
 * - qwen/qwen-2.5-vl-72b-instruct
 * - Any other vision-capable model on OpenRouter
 *
 * @since 2026-02-18
 */
import OpenAI from 'openai';
import { OCRProvider, OCR_PROMPT } from '../ocrProviderInterface.js';
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
/**
 * OpenRouter OCR Provider
 */
export class OpenRouterOCRProvider extends OCRProvider {
    constructor(config) {
        const apiKey = process.env.OPENROUTER_API_KEY;
        const enabled = !!apiKey;
        const defaultConfig = {
            name: 'openrouter',
            maxParallel: parseInt(process.env.OPENROUTER_MAX_PARALLEL || '10', 10),
            rateLimit: parseInt(process.env.OPENROUTER_RATE_LIMIT || '100', 10),
            enabled,
            priority: 2, // Secondary priority (after Gemini, before Mistral/GLM)
            model: process.env.OPENROUTER_MODEL || 'google/gemini-2.0-flash-001',
        };
        super({ ...defaultConfig, ...config });
        this.modelName = this.config.model || 'google/gemini-2.0-flash-001';
        if (apiKey) {
            this.client = new OpenAI({
                baseURL: OPENROUTER_BASE_URL,
                apiKey,
                defaultHeaders: {
                    'HTTP-Referer': 'https://video.function-eight.com',
                    'X-Title': 'Video Handoff',
                },
            });
            console.log(`[OpenRouterProvider] Initialized: model=${this.modelName}, ` +
                `maxParallel=${this.config.maxParallel}, rateLimit=${this.config.rateLimit}`);
        }
        else {
            this.client = null;
        }
    }
    /**
     * Perform OCR using OpenRouter Vision API
     */
    async performOCR(imageBuffer) {
        if (!this.isAvailable() || !this.client) {
            throw new Error('OpenRouter provider is not available');
        }
        const startTime = Date.now();
        try {
            const result = await this.rateLimiter.executeWithRetry(async () => {
                const base64Image = imageBuffer.toString('base64');
                const response = await this.client.chat.completions.create({
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
            }, (error) => this.isRetryableError(error));
            const parsed = this.parseOCRResponse(result);
            const processingTimeMs = Date.now() - startTime;
            this.updateStats(true, processingTimeMs);
            return {
                text: parsed.text,
                confidence: parsed.confidence,
                provider: this.name,
                processingTimeMs,
            };
        }
        catch (error) {
            const processingTimeMs = Date.now() - startTime;
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.updateStats(false, processingTimeMs, errorMessage);
            if (errorMessage.includes('429') ||
                errorMessage.includes('rate') ||
                errorMessage.includes('quota') ||
                errorMessage.includes('402')) {
                this.markUnavailable(60000);
            }
            throw error;
        }
    }
}
/**
 * Create OpenRouter OCR provider with environment configuration
 */
export function createOpenRouterProvider(overrides) {
    if (!process.env.OPENROUTER_API_KEY) {
        return null;
    }
    return new OpenRouterOCRProvider(overrides);
}
//# sourceMappingURL=openrouterProvider.js.map