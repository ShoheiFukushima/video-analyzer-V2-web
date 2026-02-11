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
import { CloudTasksClient } from '@google-cloud/tasks';
import { updateStatus } from './statusManager.js';
import { loadCheckpoint, saveCheckpoint } from './checkpointService.js';
// Cloud Tasks configuration
const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || 'video-analyzer-worker';
const LOCATION = 'us-central1';
const QUEUE_NAME = 'video-ocr-batches';
const WORKER_SECRET = process.env.WORKER_SECRET;
// Get Cloud Run service URL for the current region
function getServiceUrl() {
    // In Cloud Run, K_SERVICE and K_REVISION are set automatically
    const region = process.env.CLOUD_RUN_REGION || LOCATION;
    return process.env.CLOUD_RUN_SERVICE_URL ||
        `https://video-analyzer-worker-820467345033.${region}.run.app`;
}
// Lazy initialization of Cloud Tasks client
let tasksClient = null;
function getTasksClient() {
    if (!tasksClient) {
        tasksClient = new CloudTasksClient();
    }
    return tasksClient;
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
export async function queueOcrBatches(uploadId, userId, totalScenes, batchSize, videoPath, videoDuration) {
    const client = getTasksClient();
    const queuePath = client.queuePath(PROJECT_ID, LOCATION, QUEUE_NAME);
    const serviceUrl = getServiceUrl();
    const totalBatches = Math.ceil(totalScenes / batchSize);
    console.log(`[${uploadId}] [BatchQueue] Queueing ${totalBatches} batches (${totalScenes} scenes, ${batchSize}/batch)`);
    // Initialize batch queue status in checkpoint
    const checkpoint = await loadCheckpoint(uploadId);
    if (checkpoint) {
        // Update checkpoint with batch queue status
        const updatedCheckpoint = {
            ...checkpoint,
            currentStep: 'ocr',
            totalScenes,
            updatedAt: new Date().toISOString(),
        };
        await saveCheckpoint(updatedCheckpoint);
    }
    // Queue the first batch immediately
    // Subsequent batches will be queued by the batch completion handler
    const firstBatchPayload = {
        uploadId,
        userId,
        batchIndex: 0,
        totalBatches,
        batchSize,
        startSceneIndex: 0,
        endSceneIndex: Math.min(batchSize, totalScenes),
        videoPath,
        videoDuration,
        isLastBatch: totalBatches === 1,
    };
    await createBatchTask(uploadId, firstBatchPayload);
    // Update status to show batch processing started
    await updateStatus(uploadId, {
        progress: 25,
        message: `Batch 1/${totalBatches}: Processing ${Math.min(batchSize, totalScenes)} scenes...`,
        stage: 'batch_processing',
        phase: 2,
        phaseProgress: 25,
        subTask: `Queued ${totalBatches} batches for processing`,
    });
    console.log(`[${uploadId}] [BatchQueue] First batch queued, remaining batches will be chained`);
}
/**
 * Create a Cloud Task for a single batch
 */
async function createBatchTask(uploadId, payload, delaySeconds = 0) {
    const client = getTasksClient();
    const queuePath = client.queuePath(PROJECT_ID, LOCATION, QUEUE_NAME);
    const serviceUrl = getServiceUrl();
    const taskName = `${queuePath}/tasks/${uploadId}-batch-${payload.batchIndex}-${Date.now()}`;
    const task = {
        name: taskName,
        httpRequest: {
            httpMethod: 'POST',
            url: `${serviceUrl}/process-ocr-batch`,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${WORKER_SECRET}`,
            },
            body: Buffer.from(JSON.stringify(payload)).toString('base64'),
        },
        scheduleTime: delaySeconds > 0 ? {
            seconds: Math.floor(Date.now() / 1000) + delaySeconds,
        } : undefined,
    };
    try {
        const [response] = await client.createTask({ parent: queuePath, task });
        console.log(`[${uploadId}] [BatchQueue] Created task for batch ${payload.batchIndex + 1}/${payload.totalBatches}`);
        return response.name || taskName;
    }
    catch (error) {
        console.error(`[${uploadId}] [BatchQueue] Failed to create task for batch ${payload.batchIndex}:`, error);
        throw error;
    }
}
/**
 * Queue the next batch after current batch completes
 * Called by the batch processing endpoint on success
 */
export async function queueNextBatch(uploadId, completedBatchIndex, payload) {
    const nextBatchIndex = completedBatchIndex + 1;
    if (nextBatchIndex >= payload.totalBatches) {
        console.log(`[${uploadId}] [BatchQueue] All batches completed`);
        return false; // No more batches
    }
    const nextStartIndex = nextBatchIndex * payload.batchSize;
    // Calculate actual end index based on total scenes
    const checkpoint = await loadCheckpoint(uploadId);
    const totalScenes = checkpoint?.totalScenes || payload.endSceneIndex + (payload.totalBatches - completedBatchIndex - 1) * payload.batchSize;
    const actualEndIndex = Math.min(nextStartIndex + payload.batchSize, totalScenes);
    const nextPayload = {
        ...payload,
        batchIndex: nextBatchIndex,
        startSceneIndex: nextStartIndex,
        endSceneIndex: actualEndIndex,
        isLastBatch: nextBatchIndex === payload.totalBatches - 1,
    };
    await createBatchTask(uploadId, nextPayload, 2); // 2 second delay between batches
    return true;
}
/**
 * Mark a batch as completed and update progress
 */
export async function markBatchCompleted(uploadId, batchIndex, totalBatches, processedScenes, totalScenes) {
    const checkpoint = await loadCheckpoint(uploadId);
    if (checkpoint) {
        // Update completedOcrScenes in checkpoint
        const updatedCheckpoint = {
            ...checkpoint,
            completedOcrScenes: Array.from({ length: processedScenes }, (_, i) => i),
            updatedAt: new Date().toISOString(),
        };
        await saveCheckpoint(updatedCheckpoint);
    }
    // Calculate progress (25-90% for batch processing)
    const batchProgress = 25 + Math.floor(((batchIndex + 1) / totalBatches) * 65);
    // Calculate ETA
    const remainingBatches = totalBatches - batchIndex - 1;
    const avgBatchTime = 60; // Assume ~60 seconds per batch average
    const remainingSeconds = remainingBatches * avgBatchTime;
    const estimatedTimeRemaining = formatTimeRemaining(remainingSeconds);
    await updateStatus(uploadId, {
        progress: Math.min(batchProgress, 89), // Cap at 89% until Excel generation
        message: batchIndex + 1 < totalBatches
            ? `Batch ${batchIndex + 2}/${totalBatches}: Processing scenes...`
            : 'Generating Excel report...',
        stage: 'batch_processing',
        phase: 2,
        phaseProgress: batchProgress,
        subTask: `Completed batch ${batchIndex + 1}/${totalBatches} (${processedScenes}/${totalScenes} scenes)`,
        estimatedTimeRemaining,
    });
    console.log(`[${uploadId}] [BatchQueue] Batch ${batchIndex + 1}/${totalBatches} completed (${processedScenes} scenes)`);
}
/**
 * Mark a batch as failed and notify user immediately
 */
export async function markBatchFailed(uploadId, batchIndex, totalBatches, error, retryCount) {
    const checkpoint = await loadCheckpoint(uploadId);
    if (checkpoint) {
        // Update checkpoint with retry count
        const updatedCheckpoint = {
            ...checkpoint,
            retryCount: (checkpoint.retryCount || 0) + 1,
            updatedAt: new Date().toISOString(),
        };
        await saveCheckpoint(updatedCheckpoint);
    }
    // If max retries reached (3), mark as error
    if (retryCount >= 3) {
        await updateStatus(uploadId, {
            status: 'error',
            error: `Batch ${batchIndex + 1}/${totalBatches} failed after 3 retries: ${error.message}`,
        });
        console.error(`[${uploadId}] [BatchQueue] Batch ${batchIndex + 1} failed permanently:`, error.message);
    }
    else {
        console.warn(`[${uploadId}] [BatchQueue] Batch ${batchIndex + 1} failed (retry ${retryCount}/3):`, error.message);
        // Cloud Tasks will automatically retry
    }
}
/**
 * Format remaining time for display
 */
function formatTimeRemaining(seconds) {
    if (seconds < 60) {
        return `About ${Math.ceil(seconds)} seconds remaining`;
    }
    else if (seconds < 3600) {
        const minutes = Math.ceil(seconds / 60);
        return `About ${minutes} minute${minutes > 1 ? 's' : ''} remaining`;
    }
    else {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.ceil((seconds % 3600) / 60);
        return `About ${hours}h ${minutes}m remaining`;
    }
}
/**
 * Check if all batches are completed
 */
export async function areAllBatchesCompleted(uploadId) {
    const checkpoint = await loadCheckpoint(uploadId);
    if (!checkpoint)
        return false;
    // Check if all scenes have been processed
    const totalScenes = checkpoint.totalScenes || 0;
    const completedScenes = checkpoint.completedOcrScenes?.length || 0;
    return completedScenes >= totalScenes;
}
//# sourceMappingURL=batchQueueService.js.map