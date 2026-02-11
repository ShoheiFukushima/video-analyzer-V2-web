/**
 * OpenAI OCR Provider
 *
 * Implements OCR using OpenAI GPT-4 Vision API.
 * Fallback provider for when other providers are unavailable.
 *
 * @author Claude Code (Anthropic)
 * @since 2026-02-08
 */
import { OCRProvider, OCRResult, OCRProviderConfig } from '../ocrProviderInterface.js';
/**
 * OpenAI OCR Provider
 */
export declare class OpenAIOCRProvider extends OCRProvider {
    private readonly client;
    private readonly modelName;
    constructor(config?: Partial<OCRProviderConfig>);
    /**
     * Perform OCR using OpenAI Vision
     */
    performOCR(imageBuffer: Buffer): Promise<OCRResult>;
}
/**
 * Create OpenAI OCR provider with environment configuration
 */
export declare function createOpenAIProvider(overrides?: Partial<OCRProviderConfig>): OpenAIOCRProvider | null;
//# sourceMappingURL=openaiProvider.d.ts.map