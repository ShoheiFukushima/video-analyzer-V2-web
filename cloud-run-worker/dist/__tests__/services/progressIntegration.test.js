/**
 * Progress Integration Tests
 * Tests for integrating progress tracking with ffmpeg and pipeline
 *
 * Created: 2026-02-06
 */
import { describe, it, expect, jest } from '@jest/globals';
import { createProgressTracker, createStatusUpdateCallback, } from '../../services/progressTracker.js';
describe('Progress Integration', () => {
    describe('Frame Extraction Progress Integration', () => {
        it('should track progress during parallel frame extraction simulation', async () => {
            const progressUpdates = [];
            const callback = (progress) => {
                progressUpdates.push({ ...progress });
            };
            const tracker = createProgressTracker({
                uploadId: 'test-upload',
                totalItems: 100,
                phase: 'frame_extraction',
                onProgress: callback,
                throttleMs: 0, // Disable throttling for test
            });
            // Simulate parallel frame extraction (similar to pLimit usage in ffmpeg.ts)
            const scenes = Array.from({ length: 100 }, (_, i) => ({
                sceneNumber: i + 1,
                midTime: i * 5,
            }));
            // Process in parallel-like manner (in real code, pLimit would control concurrency)
            await Promise.all(scenes.map(async (scene) => {
                // Simulate frame extraction delay
                await new Promise((resolve) => setTimeout(resolve, 1));
                tracker.incrementProgress(`Scene ${scene.sceneNumber}`);
            }));
            // Verify progress was tracked
            expect(progressUpdates.length).toBe(100);
            expect(progressUpdates[99]).toEqual({
                uploadId: 'test-upload',
                phase: 'frame_extraction',
                totalItems: 100,
                completedItems: 100,
                percentage: 100,
                currentItem: expect.any(String), // Order not guaranteed in parallel
            });
        });
        it('should report subTask in format suitable for StatusManager', async () => {
            const tracker = createProgressTracker({
                uploadId: 'upload-123',
                totalItems: 3106,
                phase: 'frame_extraction',
            });
            // Simulate some progress
            for (let i = 0; i < 500; i++) {
                tracker.incrementProgress(`Scene ${i + 1}`);
            }
            const subTask = tracker.formatSubTask();
            expect(subTask).toBe('Processing frame 500/3106 (16%)');
        });
    });
    describe('OCR Progress Integration', () => {
        it('should track OCR processing progress', () => {
            const progressUpdates = [];
            const callback = (progress) => {
                progressUpdates.push({ ...progress });
            };
            const tracker = createProgressTracker({
                uploadId: 'test-upload',
                totalItems: 50,
                phase: 'ocr_processing',
                onProgress: callback,
                throttleMs: 0,
            });
            // Simulate OCR processing
            for (let i = 0; i < 50; i++) {
                tracker.incrementProgress(`scene-${String(i + 1).padStart(4, '0')}.png`);
            }
            expect(progressUpdates.length).toBe(50);
            expect(tracker.getProgress().percentage).toBe(100);
            expect(tracker.formatSubTask()).toBe('OCR processing 50/50 (100%)');
        });
    });
    describe('StatusManager Integration', () => {
        it('should create callback that updates StatusManager', async () => {
            const mockUpdatePhaseProgress = jest.fn(() => Promise.resolve({}));
            const callback = createStatusUpdateCallback('test-upload', mockUpdatePhaseProgress);
            // Simulate progress update
            await callback({
                uploadId: 'test-upload',
                phase: 'frame_extraction',
                totalItems: 100,
                completedItems: 50,
                percentage: 50,
                currentItem: 'Scene 50',
            });
            expect(mockUpdatePhaseProgress).toHaveBeenCalledWith('test-upload', 2, // Phase 2 for frame extraction
            expect.any(Number), // Phase progress (25-50% range)
            expect.objectContaining({
                subTask: 'Processing frame 50/100 (50%)',
                stage: 'frame_extraction',
            }));
        });
        it('should calculate correct phase progress for frame extraction', async () => {
            const mockUpdatePhaseProgress = jest.fn(() => Promise.resolve({}));
            const callback = createStatusUpdateCallback('test-upload', mockUpdatePhaseProgress);
            // Frame extraction at 0%
            await callback({
                uploadId: 'test-upload',
                phase: 'frame_extraction',
                totalItems: 100,
                completedItems: 0,
                percentage: 0,
                currentItem: null,
            });
            expect(mockUpdatePhaseProgress).toHaveBeenLastCalledWith('test-upload', 2, 25, // Start of frame extraction range
            expect.anything());
            // Frame extraction at 100%
            await callback({
                uploadId: 'test-upload',
                phase: 'frame_extraction',
                totalItems: 100,
                completedItems: 100,
                percentage: 100,
                currentItem: 'Scene 100',
            });
            expect(mockUpdatePhaseProgress).toHaveBeenLastCalledWith('test-upload', 2, 50, // End of frame extraction range
            expect.anything());
        });
        it('should calculate correct phase progress for OCR', async () => {
            const mockUpdatePhaseProgress = jest.fn(() => Promise.resolve({}));
            const callback = createStatusUpdateCallback('test-upload', mockUpdatePhaseProgress);
            // OCR at 0%
            await callback({
                uploadId: 'test-upload',
                phase: 'ocr_processing',
                totalItems: 100,
                completedItems: 0,
                percentage: 0,
                currentItem: null,
            });
            expect(mockUpdatePhaseProgress).toHaveBeenLastCalledWith('test-upload', 2, 50, // Start of OCR range
            expect.anything());
            // OCR at 100%
            await callback({
                uploadId: 'test-upload',
                phase: 'ocr_processing',
                totalItems: 100,
                completedItems: 100,
                percentage: 100,
                currentItem: 'scene-0100.png',
            });
            expect(mockUpdatePhaseProgress).toHaveBeenLastCalledWith('test-upload', 2, 75, // End of OCR range
            expect.anything());
        });
    });
    describe('Throttling in Production', () => {
        it('should throttle updates to prevent database overload', async () => {
            jest.useFakeTimers();
            let callCount = 0;
            const tracker = createProgressTracker({
                uploadId: 'test-upload',
                totalItems: 1000,
                phase: 'frame_extraction',
                onProgress: async () => {
                    callCount++;
                },
                throttleMs: 1000, // 1 second throttle (production setting)
            });
            // Simulate rapid frame extraction (1000 frames in 10 seconds)
            for (let i = 0; i < 100; i++) {
                tracker.incrementProgress(`Scene ${i + 1}`);
            }
            // Should only call once initially
            expect(callCount).toBe(1);
            // Advance 1 second
            jest.advanceTimersByTime(1000);
            // Continue processing
            for (let i = 100; i < 200; i++) {
                tracker.incrementProgress(`Scene ${i + 1}`);
            }
            // Should have called again after throttle window
            expect(callCount).toBe(2);
            jest.useRealTimers();
        });
    });
});
//# sourceMappingURL=progressIntegration.test.js.map