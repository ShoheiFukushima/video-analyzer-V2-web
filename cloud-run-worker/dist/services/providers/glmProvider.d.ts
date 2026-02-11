/**
 * GLM OCR Provider
 *
 * Implements OCR using ZhipuAI GLM-4V Vision API.
 * Excellent for Chinese and Japanese text recognition.
 *
 * @author Claude Code (Anthropic)
 * @since 2026-02-08
 */
import { OCRProvider, OCRResult, OCRProviderConfig } from '../ocrProviderInterface.js';
/**
 * GLM OCR Provider using GLM-4V vision model
 */
export declare class GLMOCRProvider extends OCRProvider {
    private readonly apiKey;
    private readonly modelName;
    private readonly baseUrl;
    constructor(config?: Partial<OCRProviderConfig>);
    /**
     * Perform OCR using GLM-4V Vision
     */
    performOCR(imageBuffer: Buffer): Promise<OCRResult>;
}
/**
 * Create GLM OCR provider with environment configuration
 */
export declare function createGLMProvider(overrides?: Partial<OCRProviderConfig>): GLMOCRProvider | null;
//# sourceMappingURL=glmProvider.d.ts.map