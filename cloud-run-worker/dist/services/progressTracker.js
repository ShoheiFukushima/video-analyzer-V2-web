/**
 * Progress Tracker Service
 * Tracks frame extraction and OCR progress with throttled callbacks
 *
 * Created: 2026-02-06
 *
 * Features:
 * - Track progress for frame extraction and OCR processing
 * - Throttled callbacks to prevent excessive status updates
 * - Always reports 100% completion
 * - Generates subTask strings compatible with StatusManager
 */
/**
 * Default throttle interval (1 second)
 */
const DEFAULT_THROTTLE_MS = 1000;
/**
 * Create a progress tracker instance
 */
export function createProgressTracker(config) {
    const { uploadId, phase, onProgress, throttleMs = DEFAULT_THROTTLE_MS } = config;
    let { totalItems } = config;
    // Validate totalItems
    if (totalItems <= 0) {
        throw new Error('totalItems must be positive');
    }
    // Internal state
    let completedItems = 0;
    let currentItem = null;
    let lastCallbackTime = 0;
    /**
     * Calculate percentage
     */
    const calculatePercentage = () => {
        if (totalItems === 0)
            return 0;
        return Math.round((completedItems / totalItems) * 100);
    };
    /**
     * Get current progress info
     */
    const getProgress = () => ({
        uploadId,
        phase,
        totalItems,
        completedItems,
        percentage: calculatePercentage(),
        currentItem,
    });
    /**
     * Call the progress callback (with throttling)
     */
    const callCallback = (forceCall = false) => {
        if (!onProgress)
            return;
        const now = Date.now();
        const isComplete = completedItems >= totalItems;
        const shouldThrottle = now - lastCallbackTime < throttleMs;
        // Always call on completion or if not throttled
        if (isComplete || !shouldThrottle || forceCall) {
            lastCallbackTime = now;
            const progress = getProgress();
            // Handle both sync and async callbacks
            const result = onProgress(progress);
            if (result instanceof Promise) {
                result.catch((err) => {
                    console.error(`[ProgressTracker] Callback error for ${uploadId}:`, err);
                });
            }
        }
    };
    /**
     * Increment progress
     */
    const incrementProgress = (itemLabel) => {
        if (completedItems < totalItems) {
            completedItems++;
        }
        if (itemLabel !== undefined) {
            currentItem = itemLabel;
        }
        callCallback();
    };
    /**
     * Format progress as subTask string
     */
    const formatSubTask = () => {
        const percentage = calculatePercentage();
        if (phase === 'frame_extraction') {
            return `Processing frame ${completedItems}/${totalItems} (${percentage}%)`;
        }
        else if (phase === 'ocr_processing') {
            return `OCR processing ${completedItems}/${totalItems} (${percentage}%)`;
        }
        return `Processing ${completedItems}/${totalItems} (${percentage}%)`;
    };
    /**
     * Reset progress
     */
    const reset = () => {
        completedItems = 0;
        currentItem = null;
        lastCallbackTime = 0;
    };
    /**
     * Update total items
     */
    const setTotalItems = (newTotal) => {
        if (newTotal < completedItems) {
            throw new Error('totalItems cannot be less than completedItems');
        }
        totalItems = newTotal;
    };
    return {
        getProgress,
        incrementProgress,
        formatSubTask,
        reset,
        setTotalItems,
    };
}
/**
 * Create a progress callback that updates StatusManager
 * This is a factory function that creates a callback compatible with StatusManager
 */
export function createStatusUpdateCallback(uploadId, updatePhaseProgress) {
    return async (progress) => {
        // Map progress phase to processing phase (1, 2, or 3)
        // Frame extraction and OCR are part of Phase 2 (Reading on-screen text)
        const processingPhase = 2;
        // Calculate phase progress (within Phase 2: 25-75%)
        // Frame extraction: 25-50% of Phase 2
        // OCR: 50-75% of Phase 2
        let phaseProgress;
        let stage;
        if (progress.phase === 'frame_extraction') {
            // Frame extraction: 25% to 50% of Phase 2
            phaseProgress = 25 + Math.round((progress.percentage / 100) * 25);
            stage = 'frame_extraction';
        }
        else {
            // OCR: 50% to 75% of Phase 2
            phaseProgress = 50 + Math.round((progress.percentage / 100) * 25);
            stage = 'ocr_processing';
        }
        const subTask = progress.phase === 'frame_extraction'
            ? `Processing frame ${progress.completedItems}/${progress.totalItems} (${progress.percentage}%)`
            : `OCR processing ${progress.completedItems}/${progress.totalItems} (${progress.percentage}%)`;
        await updatePhaseProgress(uploadId, processingPhase, phaseProgress, {
            subTask,
            stage,
        });
    };
}
//# sourceMappingURL=progressTracker.js.map