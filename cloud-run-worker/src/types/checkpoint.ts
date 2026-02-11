/**
 * Checkpoint Types for Long Video Processing
 *
 * Enables resumable processing for videos up to 2GB/10+ hours
 */

import type { TranscriptionSegment, SceneCut } from './shared.js';

/**
 * Processing checkpoint step
 */
export type CheckpointStep =
  | 'downloading'        // R2 download in progress
  | 'audio_extraction'   // Audio extraction from video
  | 'transcription'      // Whisper processing
  | 'scene_detection'    // FFmpeg scene detection
  | 'ocr'                // Gemini/Mistral OCR processing
  | 'excel_generation';  // Final Excel report generation

/**
 * Processing checkpoint data
 * Stored in Turso for durability, with intermediate files in R2
 */
export interface ProcessingCheckpoint {
  uploadId: string;
  userId: string;
  currentStep: CheckpointStep;

  // Intermediate file paths (R2 keys)
  intermediateVideoPath?: string;
  intermediateAudioPath?: string;

  // Video metadata
  videoDuration?: number;
  totalAudioChunks?: number;
  totalScenes?: number;

  // Progress tracking
  completedAudioChunks: number[];           // Indices of completed chunks
  transcriptionSegments: TranscriptionSegment[];
  sceneCuts: SceneCut[];
  completedOcrScenes: number[];             // Indices of completed OCR scenes
  ocrResults: Record<number, string>;       // sceneIndex -> ocrText

  // Timestamps
  createdAt: string;
  updatedAt: string;
  expiresAt: string;  // 7 days from creation

  // Retry and versioning
  retryCount: number;
  version: number;  // For optimistic locking
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
export const WHISPER_CHECKPOINT_INTERVAL = 10;

/**
 * OCR checkpoint - save every N scenes
 * Lower values = more frequent saves = better resume granularity
 * Previously 100, reduced to 10 to prevent data loss on SIGTERM
 */
export const OCR_CHECKPOINT_INTERVAL = 10;

// Export for use in other modules
export { WHISPER_CHECKPOINT_INTERVAL as WHISPER_INTERVAL, OCR_CHECKPOINT_INTERVAL as OCR_INTERVAL };

/**
 * Checkpoint expiration in days
 */
export const CHECKPOINT_EXPIRATION_DAYS = 7;

/**
 * R2 intermediate file paths
 */
export interface IntermediateFilePaths {
  video: string;   // uploads/{userId}/{uploadId}/source.mp4
  audio: string;   // uploads/{userId}/{uploadId}/audio.mp3
  frames: string;  // uploads/{userId}/{uploadId}/frames/
}

/**
 * Generate intermediate file paths for a given upload
 */
export function generateIntermediatePaths(userId: string, uploadId: string): IntermediateFilePaths {
  const basePath = `uploads/${userId}/${uploadId}`;
  return {
    video: `${basePath}/source.mp4`,
    audio: `${basePath}/audio.mp3`,
    frames: `${basePath}/frames/`,
  };
}

/**
 * Check if a checkpoint is expired
 */
export function isCheckpointExpired(checkpoint: ProcessingCheckpoint): boolean {
  return new Date(checkpoint.expiresAt) < new Date();
}

/**
 * Create initial checkpoint
 */
export function createInitialCheckpoint(
  uploadId: string,
  userId: string
): ProcessingCheckpoint {
  const now = new Date();
  const expiresAt = new Date(now);
  expiresAt.setDate(expiresAt.getDate() + CHECKPOINT_EXPIRATION_DAYS);

  return {
    uploadId,
    userId,
    currentStep: 'downloading',
    completedAudioChunks: [],
    transcriptionSegments: [],
    sceneCuts: [],
    completedOcrScenes: [],
    ocrResults: {},
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    retryCount: 0,
    version: 1,
  };
}
