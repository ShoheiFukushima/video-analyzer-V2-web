/**
 * Checkpoint Service for Long Video Processing
 *
 * Manages checkpoints in Turso and intermediate files in R2
 * for resumable processing of large videos (up to 2GB/10+ hours)
 */
import type { TranscriptionSegment, SceneCut } from '../types/shared.js';
import type { ProcessingCheckpoint, CheckpointStep, CheckpointUpdate, CheckpointSaveOptions, IntermediateFilePaths } from '../types/checkpoint.js';
import { CHECKPOINT_EXPIRATION_DAYS, createInitialCheckpoint, generateIntermediatePaths, isCheckpointExpired } from '../types/checkpoint.js';
/**
 * Load checkpoint from Turso (or in-memory for development)
 */
export declare function loadCheckpoint(uploadId: string): Promise<ProcessingCheckpoint | null>;
/**
 * Save checkpoint to Turso (or in-memory for development)
 */
export declare function saveCheckpoint(checkpoint: ProcessingCheckpoint, options?: CheckpointSaveOptions): Promise<void>;
/**
 * Update checkpoint with partial data
 */
export declare function updateCheckpoint(uploadId: string, update: CheckpointUpdate): Promise<ProcessingCheckpoint>;
/**
 * Delete checkpoint and associated R2 files
 */
export declare function deleteCheckpoint(uploadId: string): Promise<void>;
/**
 * Create or get existing checkpoint
 */
export declare function getOrCreateCheckpoint(uploadId: string, userId: string): Promise<ProcessingCheckpoint>;
/**
 * Update checkpoint step
 */
export declare function updateCheckpointStep(uploadId: string, step: CheckpointStep): Promise<void>;
/**
 * Add completed audio chunks to checkpoint
 */
export declare function addCompletedAudioChunks(uploadId: string, chunkIndices: number[], segments: TranscriptionSegment[]): Promise<void>;
/**
 * Set scene cuts in checkpoint
 */
export declare function setSceneCuts(uploadId: string, sceneCuts: SceneCut[]): Promise<void>;
/**
 * Add completed OCR scenes to checkpoint
 */
export declare function addCompletedOcrScenes(uploadId: string, sceneIndices: number[], ocrResults: Record<number, string>): Promise<void>;
/**
 * Get intermediate file paths for a checkpoint
 */
export declare function getIntermediatePaths(userId: string, uploadId: string): IntermediateFilePaths;
/**
 * Cleanup expired checkpoints (run periodically)
 */
export declare function cleanupExpiredCheckpoints(): Promise<number>;
/**
 * Check if processing can resume from checkpoint
 */
export declare function canResumeFromCheckpoint(uploadId: string, userId: string): Promise<{
    canResume: boolean;
    step?: CheckpointStep;
    message?: string;
}>;
export { createInitialCheckpoint, generateIntermediatePaths, isCheckpointExpired, CHECKPOINT_EXPIRATION_DAYS, };
export type { ProcessingCheckpoint, CheckpointStep, CheckpointUpdate, IntermediateFilePaths };
export { WHISPER_CHECKPOINT_INTERVAL, OCR_CHECKPOINT_INTERVAL } from '../types/checkpoint.js';
//# sourceMappingURL=checkpointService.d.ts.map