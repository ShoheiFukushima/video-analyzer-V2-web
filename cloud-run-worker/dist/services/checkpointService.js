/**
 * Checkpoint Service for Long Video Processing
 *
 * Manages checkpoints in Turso and intermediate files in R2
 * for resumable processing of large videos (up to 2GB/10+ hours)
 */
import dotenv from 'dotenv';
import { createClient } from '@libsql/client';
import { CHECKPOINT_EXPIRATION_DAYS, createInitialCheckpoint, generateIntermediatePaths, isCheckpointExpired, } from '../types/checkpoint.js';
import { deleteFromR2 } from './r2Client.js';
// Load environment variables
dotenv.config();
// Turso client (lazy initialization)
let turso = null;
let tursoInitialized = false;
/**
 * Get Turso client (lazy initialization)
 */
function getTursoClient() {
    if (tursoInitialized) {
        return turso;
    }
    const useTurso = process.env.NODE_ENV === 'production' || process.env.USE_TURSO === 'true';
    if (!useTurso) {
        console.log('[CheckpointService] In-memory mode (development)');
        tursoInitialized = true;
        return null;
    }
    if (!process.env.TURSO_DATABASE_URL || !process.env.TURSO_AUTH_TOKEN) {
        console.error('[CheckpointService] Missing Turso credentials');
        tursoInitialized = true;
        return null;
    }
    try {
        turso = createClient({
            url: process.env.TURSO_DATABASE_URL,
            authToken: process.env.TURSO_AUTH_TOKEN,
        });
        console.log('[CheckpointService] Turso mode enabled');
        tursoInitialized = true;
        return turso;
    }
    catch (error) {
        console.error('[CheckpointService] Failed to initialize Turso:', error);
        tursoInitialized = true;
        return null;
    }
}
// In-memory fallback for development
const inMemoryCheckpoints = new Map();
/**
 * Load checkpoint from Turso (or in-memory for development)
 */
export async function loadCheckpoint(uploadId) {
    const client = getTursoClient();
    if (client) {
        try {
            const result = await client.execute({
                sql: 'SELECT * FROM processing_checkpoints WHERE upload_id = ?',
                args: [uploadId],
            });
            if (result.rows.length === 0) {
                console.log(`[${uploadId}] [Checkpoint] No checkpoint found`);
                return null;
            }
            const row = result.rows[0];
            const checkpoint = mapRowToCheckpoint(row);
            // Check if expired
            if (isCheckpointExpired(checkpoint)) {
                console.log(`[${uploadId}] [Checkpoint] Checkpoint expired, deleting`);
                await deleteCheckpoint(uploadId);
                return null;
            }
            console.log(`[${uploadId}] [Checkpoint] Loaded checkpoint at step: ${checkpoint.currentStep}`);
            return checkpoint;
        }
        catch (error) {
            console.error(`[${uploadId}] [Checkpoint] Failed to load:`, error);
            return null;
        }
    }
    else {
        // In-memory mode
        const checkpoint = inMemoryCheckpoints.get(uploadId);
        if (checkpoint && !isCheckpointExpired(checkpoint)) {
            console.log(`[${uploadId}] [Checkpoint] Loaded from memory at step: ${checkpoint.currentStep}`);
            return checkpoint;
        }
        return null;
    }
}
/**
 * Save checkpoint to Turso (or in-memory for development)
 */
export async function saveCheckpoint(checkpoint, options = {}) {
    const { incrementVersion = true, incrementRetry = false } = options;
    const now = new Date().toISOString();
    const updatedCheckpoint = {
        ...checkpoint,
        updatedAt: now,
        version: incrementVersion ? checkpoint.version + 1 : checkpoint.version,
        retryCount: incrementRetry ? checkpoint.retryCount + 1 : checkpoint.retryCount,
    };
    const client = getTursoClient();
    if (client) {
        try {
            await client.execute({
                sql: `INSERT INTO processing_checkpoints (
          upload_id, user_id, current_step,
          intermediate_video_path, intermediate_audio_path,
          video_duration, total_audio_chunks, total_scenes,
          completed_audio_chunks, transcription_segments, scene_cuts,
          completed_ocr_scenes, ocr_results,
          created_at, updated_at, expires_at,
          retry_count, version
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(upload_id) DO UPDATE SET
          current_step = excluded.current_step,
          intermediate_video_path = excluded.intermediate_video_path,
          intermediate_audio_path = excluded.intermediate_audio_path,
          video_duration = excluded.video_duration,
          total_audio_chunks = excluded.total_audio_chunks,
          total_scenes = excluded.total_scenes,
          completed_audio_chunks = excluded.completed_audio_chunks,
          transcription_segments = excluded.transcription_segments,
          scene_cuts = excluded.scene_cuts,
          completed_ocr_scenes = excluded.completed_ocr_scenes,
          ocr_results = excluded.ocr_results,
          updated_at = excluded.updated_at,
          retry_count = excluded.retry_count,
          version = excluded.version
        `,
                args: [
                    updatedCheckpoint.uploadId,
                    updatedCheckpoint.userId,
                    updatedCheckpoint.currentStep,
                    updatedCheckpoint.intermediateVideoPath ?? null,
                    updatedCheckpoint.intermediateAudioPath ?? null,
                    updatedCheckpoint.videoDuration ?? null,
                    updatedCheckpoint.totalAudioChunks ?? null,
                    updatedCheckpoint.totalScenes ?? null,
                    JSON.stringify(updatedCheckpoint.completedAudioChunks),
                    JSON.stringify(updatedCheckpoint.transcriptionSegments),
                    JSON.stringify(updatedCheckpoint.sceneCuts),
                    JSON.stringify(updatedCheckpoint.completedOcrScenes),
                    JSON.stringify(updatedCheckpoint.ocrResults),
                    updatedCheckpoint.createdAt,
                    updatedCheckpoint.updatedAt,
                    updatedCheckpoint.expiresAt,
                    updatedCheckpoint.retryCount,
                    updatedCheckpoint.version,
                ],
            });
            console.log(`[${updatedCheckpoint.uploadId}] [Checkpoint] Saved at step: ${updatedCheckpoint.currentStep} (v${updatedCheckpoint.version})`);
        }
        catch (error) {
            console.error(`[${updatedCheckpoint.uploadId}] [Checkpoint] Failed to save:`, error);
            throw error;
        }
    }
    else {
        // In-memory mode
        inMemoryCheckpoints.set(updatedCheckpoint.uploadId, updatedCheckpoint);
        console.log(`[${updatedCheckpoint.uploadId}] [Checkpoint] Saved to memory at step: ${updatedCheckpoint.currentStep}`);
    }
}
/**
 * Update checkpoint with partial data
 */
export async function updateCheckpoint(uploadId, update) {
    const existing = await loadCheckpoint(uploadId);
    if (!existing) {
        throw new Error(`[${uploadId}] Checkpoint not found`);
    }
    const updated = {
        ...existing,
        ...update,
        updatedAt: new Date().toISOString(),
    };
    await saveCheckpoint(updated);
    return updated;
}
/**
 * Delete checkpoint and associated R2 files
 */
export async function deleteCheckpoint(uploadId) {
    const checkpoint = await loadCheckpoint(uploadId);
    // Delete intermediate files from R2
    if (checkpoint) {
        try {
            if (checkpoint.intermediateVideoPath) {
                await deleteFromR2(checkpoint.intermediateVideoPath);
                console.log(`[${uploadId}] [Checkpoint] Deleted intermediate video`);
            }
            if (checkpoint.intermediateAudioPath) {
                await deleteFromR2(checkpoint.intermediateAudioPath);
                console.log(`[${uploadId}] [Checkpoint] Deleted intermediate audio`);
            }
            // Note: Frame files are in a directory, would need listing to delete all
        }
        catch (error) {
            console.error(`[${uploadId}] [Checkpoint] Failed to delete intermediate files:`, error);
        }
    }
    // Delete checkpoint record
    const client = getTursoClient();
    if (client) {
        try {
            await client.execute({
                sql: 'DELETE FROM processing_checkpoints WHERE upload_id = ?',
                args: [uploadId],
            });
            console.log(`[${uploadId}] [Checkpoint] Deleted from Turso`);
        }
        catch (error) {
            console.error(`[${uploadId}] [Checkpoint] Failed to delete:`, error);
        }
    }
    else {
        inMemoryCheckpoints.delete(uploadId);
        console.log(`[${uploadId}] [Checkpoint] Deleted from memory`);
    }
}
/**
 * Create or get existing checkpoint
 */
export async function getOrCreateCheckpoint(uploadId, userId) {
    const existing = await loadCheckpoint(uploadId);
    if (existing) {
        console.log(`[${uploadId}] [Checkpoint] Resuming from step: ${existing.currentStep}`);
        return existing;
    }
    const newCheckpoint = createInitialCheckpoint(uploadId, userId);
    await saveCheckpoint(newCheckpoint, { incrementVersion: false });
    console.log(`[${uploadId}] [Checkpoint] Created new checkpoint`);
    return newCheckpoint;
}
/**
 * Update checkpoint step
 */
export async function updateCheckpointStep(uploadId, step) {
    await updateCheckpoint(uploadId, { currentStep: step });
}
/**
 * Add completed audio chunks to checkpoint
 */
export async function addCompletedAudioChunks(uploadId, chunkIndices, segments) {
    const checkpoint = await loadCheckpoint(uploadId);
    if (!checkpoint) {
        throw new Error(`[${uploadId}] Checkpoint not found`);
    }
    const updatedChunks = [...new Set([...checkpoint.completedAudioChunks, ...chunkIndices])];
    const updatedSegments = [...checkpoint.transcriptionSegments, ...segments];
    await updateCheckpoint(uploadId, {
        completedAudioChunks: updatedChunks,
        transcriptionSegments: updatedSegments,
    });
}
/**
 * Set scene cuts in checkpoint
 */
export async function setSceneCuts(uploadId, sceneCuts) {
    await updateCheckpoint(uploadId, {
        currentStep: 'ocr',
        sceneCuts,
        totalScenes: sceneCuts.length,
    });
}
/**
 * Add completed OCR scenes to checkpoint
 */
export async function addCompletedOcrScenes(uploadId, sceneIndices, ocrResults) {
    const checkpoint = await loadCheckpoint(uploadId);
    if (!checkpoint) {
        throw new Error(`[${uploadId}] Checkpoint not found`);
    }
    const updatedScenes = [...new Set([...checkpoint.completedOcrScenes, ...sceneIndices])];
    const updatedResults = { ...checkpoint.ocrResults, ...ocrResults };
    await updateCheckpoint(uploadId, {
        completedOcrScenes: updatedScenes,
        ocrResults: updatedResults,
    });
}
/**
 * Get intermediate file paths for a checkpoint
 */
export function getIntermediatePaths(userId, uploadId) {
    return generateIntermediatePaths(userId, uploadId);
}
/**
 * Cleanup expired checkpoints (run periodically)
 */
export async function cleanupExpiredCheckpoints() {
    const client = getTursoClient();
    if (!client) {
        return 0;
    }
    const now = new Date().toISOString();
    try {
        // Get expired checkpoints for R2 cleanup
        const expired = await client.execute({
            sql: 'SELECT upload_id, intermediate_video_path, intermediate_audio_path FROM processing_checkpoints WHERE expires_at < ?',
            args: [now],
        });
        // Delete intermediate files from R2
        for (const row of expired.rows) {
            const uploadId = row.upload_id;
            const videoPath = row.intermediate_video_path;
            const audioPath = row.intermediate_audio_path;
            try {
                if (videoPath)
                    await deleteFromR2(videoPath);
                if (audioPath)
                    await deleteFromR2(audioPath);
                console.log(`[${uploadId}] [Checkpoint] Cleaned up expired intermediate files`);
            }
            catch (error) {
                console.error(`[${uploadId}] [Checkpoint] Failed to cleanup intermediate files:`, error);
            }
        }
        // Delete expired checkpoint records
        const result = await client.execute({
            sql: 'DELETE FROM processing_checkpoints WHERE expires_at < ?',
            args: [now],
        });
        console.log(`[CheckpointService] Cleaned up ${result.rowsAffected} expired checkpoints`);
        return result.rowsAffected;
    }
    catch (error) {
        console.error('[CheckpointService] Failed to cleanup expired checkpoints:', error);
        return 0;
    }
}
/**
 * Check if processing can resume from checkpoint
 */
export async function canResumeFromCheckpoint(uploadId, userId) {
    const checkpoint = await loadCheckpoint(uploadId);
    if (!checkpoint) {
        return { canResume: false, message: 'No checkpoint found' };
    }
    if (checkpoint.userId !== userId) {
        return { canResume: false, message: 'User ID mismatch' };
    }
    if (isCheckpointExpired(checkpoint)) {
        return { canResume: false, message: 'Checkpoint expired' };
    }
    return {
        canResume: true,
        step: checkpoint.currentStep,
        message: `Can resume from step: ${checkpoint.currentStep}`,
    };
}
/**
 * Map database row to ProcessingCheckpoint
 */
function mapRowToCheckpoint(row) {
    return {
        uploadId: row.upload_id,
        userId: row.user_id,
        currentStep: row.current_step,
        intermediateVideoPath: row.intermediate_video_path,
        intermediateAudioPath: row.intermediate_audio_path,
        videoDuration: row.video_duration,
        totalAudioChunks: row.total_audio_chunks,
        totalScenes: row.total_scenes,
        completedAudioChunks: JSON.parse(row.completed_audio_chunks || '[]'),
        transcriptionSegments: JSON.parse(row.transcription_segments || '[]'),
        sceneCuts: JSON.parse(row.scene_cuts || '[]'),
        completedOcrScenes: JSON.parse(row.completed_ocr_scenes || '[]'),
        ocrResults: JSON.parse(row.ocr_results || '{}'),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        expiresAt: row.expires_at,
        retryCount: row.retry_count,
        version: row.version,
    };
}
// Export types and utilities
export { createInitialCheckpoint, generateIntermediatePaths, isCheckpointExpired, CHECKPOINT_EXPIRATION_DAYS, };
// Re-export checkpoint intervals from types
export { WHISPER_CHECKPOINT_INTERVAL, OCR_CHECKPOINT_INTERVAL } from '../types/checkpoint.js';
//# sourceMappingURL=checkpointService.js.map