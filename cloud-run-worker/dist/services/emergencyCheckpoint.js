/**
 * Emergency Checkpoint Service
 *
 * Tracks in-progress OCR/Whisper state for emergency save on SIGTERM.
 * This module provides a way to save the current processing state
 * immediately when the server is shutting down.
 */
import { addCompletedOcrScenes, loadCheckpoint, saveCheckpoint } from './checkpointService.js';
// Global state for emergency save
let currentOcrState = null;
/**
 * Register the current OCR processing state
 * Called by pipeline.ts during OCR processing
 */
export function registerOcrProgress(uploadId, completedScenes, ocrResults, lastSavedIndex) {
    currentOcrState = {
        uploadId,
        completedScenes,
        ocrResults,
        lastSavedIndex,
    };
}
/**
 * Clear the OCR progress state (called on completion or error)
 */
export function clearOcrProgress() {
    currentOcrState = null;
}
/**
 * Get current OCR progress state
 */
export function getOcrProgress() {
    return currentOcrState;
}
/**
 * Emergency save of in-progress OCR state
 * Called by SIGTERM handler in index.ts
 * Returns true if save was successful
 */
export async function emergencySaveOcrProgress() {
    if (!currentOcrState) {
        console.log('[EmergencyCheckpoint] No in-progress OCR state to save');
        return false;
    }
    const { uploadId, completedScenes, ocrResults, lastSavedIndex } = currentOcrState;
    // Calculate unsaved scenes
    const unsavedScenes = completedScenes.filter(idx => idx > lastSavedIndex);
    const unsavedResults = {};
    for (const idx of unsavedScenes) {
        if (ocrResults[idx] !== undefined) {
            unsavedResults[idx] = ocrResults[idx];
        }
    }
    if (unsavedScenes.length === 0) {
        console.log(`[${uploadId}] [EmergencyCheckpoint] No unsaved OCR scenes`);
        return true;
    }
    console.log(`[${uploadId}] [EmergencyCheckpoint] Saving ${unsavedScenes.length} unsaved OCR scenes...`);
    try {
        await addCompletedOcrScenes(uploadId, unsavedScenes, unsavedResults);
        console.log(`[${uploadId}] [EmergencyCheckpoint] Successfully saved ${unsavedScenes.length} scenes`);
        return true;
    }
    catch (error) {
        console.error(`[${uploadId}] [EmergencyCheckpoint] Failed to save:`, error);
        return false;
    }
}
/**
 * Emergency save of current checkpoint with 'interrupted' status
 * This marks the checkpoint as interrupted so the next run knows to resume
 */
export async function markCheckpointInterrupted(uploadId) {
    try {
        const checkpoint = await loadCheckpoint(uploadId);
        if (!checkpoint) {
            console.log(`[${uploadId}] [EmergencyCheckpoint] No checkpoint found to mark as interrupted`);
            return false;
        }
        // Update the checkpoint with current timestamp
        // The next processVideo() call will detect this and resume
        await saveCheckpoint({
            ...checkpoint,
            updatedAt: new Date().toISOString(),
        }, { incrementRetry: true });
        console.log(`[${uploadId}] [EmergencyCheckpoint] Checkpoint marked as interrupted (retry #${checkpoint.retryCount + 1})`);
        return true;
    }
    catch (error) {
        console.error(`[${uploadId}] [EmergencyCheckpoint] Failed to mark interrupted:`, error);
        return false;
    }
}
//# sourceMappingURL=emergencyCheckpoint.js.map