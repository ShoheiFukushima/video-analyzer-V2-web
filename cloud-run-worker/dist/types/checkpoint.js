/**
 * Checkpoint Types for Long Video Processing
 *
 * Enables resumable processing for videos up to 2GB/10+ hours
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
/**
 * Get the current build commit hash from build-info.json
 */
function getCurrentBuildCommit() {
    try {
        // Try multiple paths (dist/ for production, root for development)
        const paths = [
            join(dirname(fileURLToPath(import.meta.url)), '..', 'build-info.json'),
            join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'build-info.json'),
        ];
        for (const p of paths) {
            try {
                const info = JSON.parse(readFileSync(p, 'utf-8'));
                return info.commit;
            }
            catch { /* try next */ }
        }
    }
    catch { /* ignore */ }
    return undefined;
}
// Cache the build commit at module load time
export const CURRENT_BUILD_COMMIT = getCurrentBuildCommit();
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
 * Generate intermediate file paths for a given upload
 */
export function generateIntermediatePaths(userId, uploadId) {
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
export function isCheckpointExpired(checkpoint) {
    return new Date(checkpoint.expiresAt) < new Date();
}
/**
 * Create initial checkpoint
 */
export function createInitialCheckpoint(uploadId, userId) {
    const now = new Date();
    const expiresAt = new Date(now);
    expiresAt.setDate(expiresAt.getDate() + CHECKPOINT_EXPIRATION_DAYS);
    return {
        uploadId,
        userId,
        currentStep: 'downloading',
        buildCommit: CURRENT_BUILD_COMMIT,
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
//# sourceMappingURL=checkpoint.js.map