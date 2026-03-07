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
import { OCRProvider, OCRResult, OCRProviderConfig } from '../ocrProviderInterface.js';
/**
 * OpenRouter OCR Provider
 */
export declare class OpenRouterOCRProvider extends OCRProvider {
    private readonly client;
    private readonly modelName;
    constructor(config?: Partial<OCRProviderConfig>);
    /**
     * Perform OCR using OpenRouter Vision API
     */
    performOCR(imageBuffer: Buffer): Promise<OCRResult>;
}
/**
 * Create OpenRouter OCR provider with environment configuration
 */
export declare function createOpenRouterProvider(overrides?: Partial<OCRProviderConfig>): OpenRouterOCRProvider | null;
//# sourceMappingURL=openrouterProvider.d.ts.map