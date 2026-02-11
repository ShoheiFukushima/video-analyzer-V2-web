/**
 * Emergency Checkpoint Service
 *
 * Tracks in-progress OCR/Whisper state for emergency save on SIGTERM.
 * This module provides a way to save the current processing state
 * immediately when the server is shutting down.
 */
/**
 * In-progress OCR state (updated during processing)
 */
interface InProgressOcrState {
    uploadId: string;
    completedScenes: number[];
    ocrResults: Record<number, string>;
    lastSavedIndex: number;
}
/**
 * Register the current OCR processing state
 * Called by pipeline.ts during OCR processing
 */
export declare function registerOcrProgress(uploadId: string, completedScenes: number[], ocrResults: Record<number, string>, lastSavedIndex: number): void;
/**
 * Clear the OCR progress state (called on completion or error)
 */
export declare function clearOcrProgress(): void;
/**
 * Get current OCR progress state
 */
export declare function getOcrProgress(): InProgressOcrState | null;
/**
 * Emergency save of in-progress OCR state
 * Called by SIGTERM handler in index.ts
 * Returns true if save was successful
 */
export declare function emergencySaveOcrProgress(): Promise<boolean>;
/**
 * Emergency save of current checkpoint with 'interrupted' status
 * This marks the checkpoint as interrupted so the next run knows to resume
 */
export declare function markCheckpointInterrupted(uploadId: string): Promise<boolean>;
export {};
//# sourceMappingURL=emergencyCheckpoint.d.ts.map