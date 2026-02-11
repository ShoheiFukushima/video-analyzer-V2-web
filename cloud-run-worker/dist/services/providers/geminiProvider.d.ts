/**
 * Gemini OCR Provider
 *
 * Implements OCR using Google Gemini Vision API.
 * Primary provider for video subtitle extraction.
 *
 * @author Claude Code (Anthropic)
 * @since 2026-02-08
 */
import { OCRProvider, OCRResult, OCRProviderConfig } from '../ocrProviderInterface.js';
/**
 * Gemini OCR Provider
 */
export declare class GeminiOCRProvider extends OCRProvider {
    private readonly genAI;
    private readonly modelName;
    constructor(config?: Partial<OCRProviderConfig>);
    /**
     * Perform OCR using Gemini Vision
     */
    performOCR(imageBuffer: Buffer): Promise<OCRResult>;
}
/**
 * Create Gemini OCR provider with environment configuration
 */
export declare function createGeminiProvider(overrides?: Partial<OCRProviderConfig>): GeminiOCRProvider | null;
//# sourceMappingURL=geminiProvider.d.ts.map