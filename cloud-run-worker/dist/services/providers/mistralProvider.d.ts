/**
 * Mistral OCR Provider
 *
 * Implements OCR using Mistral AI Vision API (Pixtral).
 * Cost-effective secondary provider with good multilingual support.
 *
 * @author Claude Code (Anthropic)
 * @since 2026-02-08
 */
import { OCRProvider, OCRResult, OCRProviderConfig } from '../ocrProviderInterface.js';
/**
 * Mistral OCR Provider using Pixtral vision model
 */
export declare class MistralOCRProvider extends OCRProvider {
    private readonly apiKey;
    private readonly modelName;
    private readonly baseUrl;
    constructor(config?: Partial<OCRProviderConfig>);
    /**
     * Perform OCR using Mistral Vision (Pixtral)
     */
    performOCR(imageBuffer: Buffer): Promise<OCRResult>;
}
/**
 * Create Mistral OCR provider with environment configuration
 */
export declare function createMistralProvider(overrides?: Partial<OCRProviderConfig>): MistralOCRProvider | null;
//# sourceMappingURL=mistralProvider.d.ts.map