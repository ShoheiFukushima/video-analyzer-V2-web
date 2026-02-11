/**
 * Mistral OCR Provider
 *
 * Implements OCR using Mistral AI Vision API (Pixtral).
 * Cost-effective secondary provider with good multilingual support.
 *
 * @author Claude Code (Anthropic)
 * @since 2026-02-08
 */
import { OCRProvider, OCR_PROMPT } from '../ocrProviderInterface.js';
// ============================================================
// Mistral Provider Implementation
// ============================================================
/**
 * Mistral OCR Provider using Pixtral vision model
 */
export class MistralOCRProvider extends OCRProvider {
    constructor(config) {
        const apiKey = process.env.MISTRAL_API_KEY;
        const enabled = !!apiKey;
        const defaultConfig = {
            name: 'mistral',
            maxParallel: parseInt(process.env.MISTRAL_MAX_PARALLEL || '10', 10),
            rateLimit: parseInt(process.env.MISTRAL_RATE_LIMIT || '100', 10),
            enabled,
            priority: 2,
            model: process.env.MISTRAL_MODEL || 'pixtral-12b-2409',
        };
        super({ ...defaultConfig, ...config });
        this.modelName = this.config.model || 'pixtral-12b-2409';
        this.apiKey = apiKey || null;
        this.baseUrl = process.env.MISTRAL_API_BASE || 'https://api.mistral.ai/v1';
        if (apiKey) {
            console.log(`[MistralProvider] Initialized: model=${this.modelName}, ` +
                `maxParallel=${this.config.maxParallel}, rateLimit=${this.config.rateLimit}`);
        }
        else {
            console.warn('[MistralProvider] No MISTRAL_API_KEY found, provider disabled');
        }
    }
    /**
     * Perform OCR using Mistral Vision (Pixtral)
     */
    async performOCR(imageBuffer) {
        if (!this.isAvailable() || !this.apiKey) {
            throw new Error('Mistral provider is not available');
        }
        const startTime = Date.now();
        try {
            const result = await this.rateLimiter.executeWithRetry(async () => {
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
                                        image_url: `data:image/png;base64,${base64Image}`,
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
                    throw new Error(`Mistral API error: ${response.status} - ${errorText}`);
                }
                const data = (await response.json());
                return data.choices[0]?.message?.content || '';
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
            // Mark unavailable on rate limit or server errors
            if (errorMessage.includes('429') ||
                errorMessage.includes('rate') ||
                errorMessage.includes('quota')) {
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
 * Create Mistral OCR provider with environment configuration
 */
export function createMistralProvider(overrides) {
    if (!process.env.MISTRAL_API_KEY) {
        console.warn('[MistralProvider] Skipping creation - no API key');
        return null;
    }
    return new MistralOCRProvider(overrides);
}
//# sourceMappingURL=mistralProvider.js.map