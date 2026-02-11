/**
 * Checkpoint Types for Long Video Processing
 *
 * Enables resumable processing for videos up to 2GB/10+ hours
 */
import type { TranscriptionSegment, SceneCut } from './shared.js';
/**
 * Processing checkpoint step
 */
export type CheckpointStep = 'downloading' | 'audio_extraction' | 'transcription' | 'scene_detection' | 'ocr' | 'excel_generation';
/**
 * Processing checkpoint data
 * Stored in Turso for durability, with intermediate files in R2
 */
export interface ProcessingCheckpoint {
    uploadId: string;
    userId: string;
    currentStep: CheckpointStep;
    intermediateVideoPath?: string;
    intermediateAudioPath?: string;
    videoDuration?: number;
    totalAudioChunks?: number;
    totalScenes?: number;
    completedAudioChunks: number[];
    transcriptionSegments: TranscriptionSegment[];
    sceneCuts: SceneCut[];
    completedOcrScenes: number[];
    ocrResults: Record<number, string>;
    createdAt: string;
    updatedAt: string;
    expiresAt: string;
    retryCount: number;
    version: number;
}
/**
 * Checkpoint save options
 */
export interface CheckpointSaveOptions {
    /** Increment version for optimistic locking */
    incrementVersion?: boolean;
    /** Increment retry count */
    incrementRetry?: boolean;
}
/**
 * Checkpoint update data (partial update)
 */
export type CheckpointUpdate = Partial<Omit<ProcessingCheckpoint, 'uploadId' | 'userId' | 'createdAt'>>;
/**
 * Whisper checkpoint - save every N chunks
 * Lower values = more frequent saves = better resume granularity
 */
export declare const WHISPER_CHECKPOINT_INTERVAL = 10;
/**
 * OCR checkpoint - save every N scenes
 * Lower values = more frequent saves = better resume granularity
 * Previously 100, reduced to 10 to prevent data loss on SIGTERM
 */
export declare const OCR_CHECKPOINT_INTERVAL = 10;
export { WHISPER_CHECKPOINT_INTERVAL as WHISPER_INTERVAL, OCR_CHECKPOINT_INTERVAL as OCR_INTERVAL };
/**
 * Checkpoint expiration in days
 */
export declare const CHECKPOINT_EXPIRATION_DAYS = 7;
/**
 * R2 intermediate file paths
 */
export interface IntermediateFilePaths {
    video: string;
    audio: string;
    frames: string;
}
/**
 * Generate intermediate file paths for a given upload
 */
export declare function generateIntermediatePaths(userId: string, uploadId: string): IntermediateFilePaths;
/**
 * Check if a checkpoint is expired
 */
export declare function isCheckpointExpired(checkpoint: ProcessingCheckpoint): boolean;
/**
 * Create initial checkpoint
 */
export declare function createInitialCheckpoint(uploadId: string, userId: string): ProcessingCheckpoint;
//# sourceMappingURL=checkpoint.d.ts.map