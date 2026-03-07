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
export type OCRErrorCategory = 'rate_limit' | 'auth' | 'network' | 'server' | 'unknown';
/**
 * Extract detailed error information from Gemini SDK errors
 * Gemini SDK wraps HTTP errors in GoogleGenerativeAIError with nested structures
 */
export declare function classifyGeminiError(error: unknown): {
    category: OCRErrorCategory;
    status?: number;
    code?: string;
    detail: string;
};
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