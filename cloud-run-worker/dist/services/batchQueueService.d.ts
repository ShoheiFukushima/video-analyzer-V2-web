/**
 * Cloud Tasks Batch Queue Service
 *
 * Manages queueing and execution of OCR batch processing tasks.
 * Each batch is a separate Cloud Task, enabling:
 * - Automatic retry on failure
 * - Per-batch timeout (not entire job)
 * - Immediate error notification
 * - Resumable processing
 */
/**
 * Batch task payload - sent to /process-ocr-batch endpoint
 */
export interface BatchTaskPayload {
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
 * Batch queue status stored in checkpoint
 */
export interface BatchQueueStatus {
    totalBatches: number;
    completedBatches: number[];
    failedBatches: number[];
    currentBatch: number | null;
    queuedAt: string;
    startedAt?: string;
    completedAt?: string;
}
/**
 * Queue all OCR batches for a video
 *
 * @param uploadId - Upload ID
 * @param userId - User ID
 * @param totalScenes - Total number of scenes to process
 * @param batchSize - Scenes per batch (default: 100)
 * @param videoPath - R2 key for the video
 * @param videoDuration - Video duration in seconds
 */
export declare function queueOcrBatches(uploadId: string, userId: string, totalScenes: number, batchSize: number, videoPath: string, videoDuration: number): Promise<void>;
/**
 * Queue the next batch after current batch completes
 * Called by the batch processing endpoint on success
 */
export declare function queueNextBatch(uploadId: string, completedBatchIndex: number, payload: BatchTaskPayload): Promise<boolean>;
/**
 * Mark a batch as completed and update progress
 */
export declare function markBatchCompleted(uploadId: string, batchIndex: number, totalBatches: number, processedScenes: number, totalScenes: number): Promise<void>;
/**
 * Mark a batch as failed and notify user immediately
 */
export declare function markBatchFailed(uploadId: string, batchIndex: number, totalBatches: number, error: Error, retryCount: number): Promise<void>;
/**
 * Check if all batches are completed
 */
export declare function areAllBatchesCompleted(uploadId: string): Promise<boolean>;
//# sourceMappingURL=batchQueueService.d.ts.map