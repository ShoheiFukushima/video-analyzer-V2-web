/**
 * LLM Cleansing Service
 *
 * Uses Gemini LLM to clean OCR/narration text:
 * - Fix OCR misrecognition (e.g., 0/O, 1/l confusion)
 * - Unify inconsistent representations of the same term
 * - Cross-reference OCR and narration for context-based correction
 * - Remove meaningless OCR noise
 *
 * Enabled via LLM_CLEANSING_ENABLED=true environment variable.
 * Graceful degradation: returns original data on failure.
 *
 * @since 2026-02-18
 */
export interface SceneTextData {
    sceneNumber: number;
    ocr: string;
    narration: string;
}
export interface CleansedResult {
    sceneNumber: number;
    ocr: string;
    narration: string;
}
/**
 * Run LLM cleansing on scene text data.
 * Returns original data unchanged if disabled or on failure.
 */
export declare function cleanseScenesWithLLM(scenes: SceneTextData[]): Promise<CleansedResult[]>;
//# sourceMappingURL=llmCleansing.d.ts.map