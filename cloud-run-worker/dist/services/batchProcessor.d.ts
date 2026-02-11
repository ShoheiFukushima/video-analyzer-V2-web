/**
 * Single Batch Processor
 *
 * Processes a single batch of scenes (frame extraction + OCR).
 * Called by Cloud Tasks for each batch.
 */
/**
 * Batch processing payload from Cloud Tasks
 */
export interface BatchPayload {
    uploadId: string;
    userId: string;
    batchIndex: number;
    totalBatches: number;
    batchSize: number;
    startSceneIndex: number;
    endSceneIndex: number;
    videoPath: string;
    videoDuration: number;
    isLastBatch: boolean;
}
/**
 * Batch processing result
 */
export interface BatchResult {
    batchIndex: number;
    processedScenes: number;
    totalScenes: number;
    ocrResults: Record<number, string>;
}
/**
 * Process a single batch of scenes
 */
export declare function processSingleBatch(payload: BatchPayload): Promise<BatchResult>;
//# sourceMappingURL=batchProcessor.d.ts.map