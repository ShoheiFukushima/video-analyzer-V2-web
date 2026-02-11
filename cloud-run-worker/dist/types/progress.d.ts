/**
 * Progress Tracking Types
 * Types for tracking frame extraction and OCR progress
 *
 * Created: 2026-02-06
 */
/**
 * Progress phase types
 */
export type ProgressPhase = 'frame_extraction' | 'ocr_processing';
/**
 * Progress information
 */
export interface ProgressInfo {
    /** Upload ID for this processing job */
    uploadId: string;
    /** Current processing phase */
    phase: ProgressPhase;
    /** Total number of items to process */
    totalItems: number;
    /** Number of completed items */
    completedItems: number;
    /** Percentage complete (0-100) */
    percentage: number;
    /** Current item being processed (optional label) */
    currentItem: string | null;
}
/**
 * Progress callback function type
 */
export type ProgressCallback = (progress: ProgressInfo) => void | Promise<void>;
/**
 * Progress tracker configuration
 */
export interface ProgressTrackerConfig {
    /** Upload ID for this processing job */
    uploadId: string;
    /** Total number of items to process */
    totalItems: number;
    /** Processing phase */
    phase: ProgressPhase;
    /** Callback function for progress updates */
    onProgress?: ProgressCallback;
    /** Throttle interval in milliseconds (default: 1000) */
    throttleMs?: number;
}
/**
 * Progress tracker interface
 */
export interface ProgressTracker {
    /** Get current progress info */
    getProgress(): ProgressInfo;
    /** Increment progress by one item */
    incrementProgress(itemLabel?: string): void;
    /** Format progress as subTask string for status updates */
    formatSubTask(): string;
    /** Reset progress to initial state */
    reset(): void;
    /** Update total items count */
    setTotalItems(total: number): void;
}
/**
 * Frame extraction progress info (extends ProgressInfo)
 */
export interface FrameExtractionProgress extends ProgressInfo {
    phase: 'frame_extraction';
    /** Scene number being processed */
    sceneNumber?: number;
    /** Timestamp of current frame */
    timestamp?: number;
}
/**
 * OCR progress info (extends ProgressInfo)
 */
export interface OCRProgress extends ProgressInfo {
    phase: 'ocr_processing';
    /** Image filename being processed */
    imagePath?: string;
}
/**
 * Aggregate progress for multi-stage processing
 */
export interface AggregateProgress {
    /** Upload ID */
    uploadId: string;
    /** Overall percentage (0-100) */
    overallPercentage: number;
    /** Frame extraction progress */
    frameExtraction: ProgressInfo | null;
    /** OCR progress */
    ocr: ProgressInfo | null;
    /** Human-readable status message */
    statusMessage: string;
}
//# sourceMappingURL=progress.d.ts.map