/**
 * Progress Tracker Tests
 * TDD tests for frame extraction and OCR progress tracking
 *
 * Created: 2026-02-06
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';

// Import types (will be created)
import type {
  ProgressCallback,
  ProgressInfo,
} from '../../types/progress.js';

// Import the progress tracker (will be created)
import {
  createProgressTracker,
} from '../../services/progressTracker.js';

describe('ProgressTracker', () => {
  describe('createProgressTracker', () => {
    it('should create a progress tracker with initial state', () => {
      const tracker = createProgressTracker({
        uploadId: 'test-upload-123',
        totalItems: 100,
        phase: 'frame_extraction',
      });

      expect(tracker).toBeDefined();
      expect(tracker.getProgress()).toEqual({
        uploadId: 'test-upload-123',
        phase: 'frame_extraction',
        totalItems: 100,
        completedItems: 0,
        percentage: 0,
        currentItem: null,
      });
    });

    it('should throw error if totalItems is 0 or negative', () => {
      expect(() =>
        createProgressTracker({
          uploadId: 'test',
          totalItems: 0,
          phase: 'frame_extraction',
        })
      ).toThrow('totalItems must be positive');

      expect(() =>
        createProgressTracker({
          uploadId: 'test',
          totalItems: -1,
          phase: 'frame_extraction',
        })
      ).toThrow('totalItems must be positive');
    });
  });

  describe('incrementProgress', () => {
    it('should increment completed items count', () => {
      const tracker = createProgressTracker({
        uploadId: 'test-upload',
        totalItems: 10,
        phase: 'frame_extraction',
      });

      tracker.incrementProgress();
      expect(tracker.getProgress().completedItems).toBe(1);
      expect(tracker.getProgress().percentage).toBe(10);

      tracker.incrementProgress();
      expect(tracker.getProgress().completedItems).toBe(2);
      expect(tracker.getProgress().percentage).toBe(20);
    });

    it('should not exceed totalItems', () => {
      const tracker = createProgressTracker({
        uploadId: 'test-upload',
        totalItems: 2,
        phase: 'frame_extraction',
      });

      tracker.incrementProgress();
      tracker.incrementProgress();
      tracker.incrementProgress(); // Should not exceed

      expect(tracker.getProgress().completedItems).toBe(2);
      expect(tracker.getProgress().percentage).toBe(100);
    });

    it('should accept optional item label', () => {
      const tracker = createProgressTracker({
        uploadId: 'test-upload',
        totalItems: 100,
        phase: 'frame_extraction',
      });

      tracker.incrementProgress('Scene 42');
      expect(tracker.getProgress().currentItem).toBe('Scene 42');
    });
  });

  describe('progress callback', () => {
    it('should call callback on each increment (with throttle disabled)', () => {
      const callback = jest.fn() as unknown as ProgressCallback;
      const tracker = createProgressTracker({
        uploadId: 'test-upload',
        totalItems: 5,
        phase: 'frame_extraction',
        onProgress: callback,
        throttleMs: 0, // Disable throttling for this test
      });

      tracker.incrementProgress('Scene 1');
      tracker.incrementProgress('Scene 2');

      expect(callback).toHaveBeenCalledTimes(2);
      expect(callback).toHaveBeenLastCalledWith({
        uploadId: 'test-upload',
        phase: 'frame_extraction',
        totalItems: 5,
        completedItems: 2,
        percentage: 40,
        currentItem: 'Scene 2',
      });
    });

    it('should not call callback if not provided', () => {
      const tracker = createProgressTracker({
        uploadId: 'test-upload',
        totalItems: 5,
        phase: 'frame_extraction',
      });

      // Should not throw
      expect(() => tracker.incrementProgress()).not.toThrow();
    });
  });

  describe('throttled callback', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should throttle callbacks to prevent excessive updates', () => {
      const callback = jest.fn() as unknown as ProgressCallback;
      const tracker = createProgressTracker({
        uploadId: 'test-upload',
        totalItems: 100,
        phase: 'frame_extraction',
        onProgress: callback,
        throttleMs: 500, // Throttle to max 1 call per 500ms
      });

      // Rapid increments
      for (let i = 0; i < 10; i++) {
        tracker.incrementProgress(`Scene ${i}`);
      }

      // Should only call once initially
      expect(callback).toHaveBeenCalledTimes(1);

      // Advance time
      jest.advanceTimersByTime(500);

      // Now should allow another call
      tracker.incrementProgress('Scene 10');
      expect(callback).toHaveBeenCalledTimes(2);
    });

    it('should always call on completion (100%)', () => {
      const callback = jest.fn() as unknown as ProgressCallback;
      const tracker = createProgressTracker({
        uploadId: 'test-upload',
        totalItems: 3,
        phase: 'frame_extraction',
        onProgress: callback,
        throttleMs: 10000, // Long throttle
      });

      tracker.incrementProgress('Scene 1'); // Called
      tracker.incrementProgress('Scene 2'); // Throttled
      tracker.incrementProgress('Scene 3'); // Should be called (100%)

      // First call + 100% completion call
      expect(callback).toHaveBeenCalledTimes(2);
      expect(callback).toHaveBeenLastCalledWith(
        expect.objectContaining({
          completedItems: 3,
          percentage: 100,
        })
      );
    });
  });

  describe('formatSubTask', () => {
    it('should format progress as subTask string', () => {
      const tracker = createProgressTracker({
        uploadId: 'test-upload',
        totalItems: 100,
        phase: 'frame_extraction',
      });

      tracker.incrementProgress('Scene 42');

      expect(tracker.formatSubTask()).toBe('Processing frame 1/100 (1%)');
    });

    it('should show custom format for OCR phase', () => {
      const tracker = createProgressTracker({
        uploadId: 'test-upload',
        totalItems: 50,
        phase: 'ocr_processing',
      });

      for (let i = 0; i < 25; i++) {
        tracker.incrementProgress();
      }

      expect(tracker.formatSubTask()).toBe('OCR processing 25/50 (50%)');
    });
  });

  describe('reset', () => {
    it('should reset progress to initial state', () => {
      const tracker = createProgressTracker({
        uploadId: 'test-upload',
        totalItems: 10,
        phase: 'frame_extraction',
      });

      tracker.incrementProgress();
      tracker.incrementProgress();
      expect(tracker.getProgress().completedItems).toBe(2);

      tracker.reset();
      expect(tracker.getProgress().completedItems).toBe(0);
      expect(tracker.getProgress().percentage).toBe(0);
      expect(tracker.getProgress().currentItem).toBeNull();
    });
  });

  describe('setTotalItems', () => {
    it('should allow updating total items (e.g., when actual count is known)', () => {
      const tracker = createProgressTracker({
        uploadId: 'test-upload',
        totalItems: 100, // Initial estimate
        phase: 'frame_extraction',
      });

      tracker.incrementProgress();
      expect(tracker.getProgress().percentage).toBe(1);

      tracker.setTotalItems(50); // Actual count known
      expect(tracker.getProgress().percentage).toBe(2); // 1/50 = 2%
    });

    it('should throw if new total is less than completed', () => {
      const tracker = createProgressTracker({
        uploadId: 'test-upload',
        totalItems: 10,
        phase: 'frame_extraction',
      });

      tracker.incrementProgress();
      tracker.incrementProgress();
      tracker.incrementProgress();

      expect(() => tracker.setTotalItems(2)).toThrow(
        'totalItems cannot be less than completedItems'
      );
    });
  });
});

describe('FrameExtractionProgress', () => {
  it('should track frame extraction with scene info', () => {
    const callback = jest.fn() as unknown as ProgressCallback;
    const tracker = createProgressTracker({
      uploadId: 'test-upload',
      totalItems: 3106,
      phase: 'frame_extraction',
      onProgress: callback,
    });

    // Simulate frame extraction
    tracker.incrementProgress('Scene 1 at 00:00:05');
    tracker.incrementProgress('Scene 2 at 00:00:12');

    expect(tracker.getProgress()).toEqual({
      uploadId: 'test-upload',
      phase: 'frame_extraction',
      totalItems: 3106,
      completedItems: 2,
      percentage: expect.any(Number),
      currentItem: 'Scene 2 at 00:00:12',
    });
  });
});

describe('OCRProgress', () => {
  it('should track OCR processing with image info', () => {
    const callback = jest.fn() as unknown as ProgressCallback;
    const tracker = createProgressTracker({
      uploadId: 'test-upload',
      totalItems: 500,
      phase: 'ocr_processing',
      onProgress: callback,
    });

    // Simulate OCR processing
    tracker.incrementProgress('scene-0001.png');
    tracker.incrementProgress('scene-0002.png');

    expect(tracker.getProgress().phase).toBe('ocr_processing');
    expect(tracker.getProgress().completedItems).toBe(2);
  });
});

describe('Integration with StatusManager', () => {
  it('should generate status update compatible with updateStatus', () => {
    const tracker = createProgressTracker({
      uploadId: 'test-upload',
      totalItems: 100,
      phase: 'frame_extraction',
    });

    for (let i = 0; i < 50; i++) {
      tracker.incrementProgress();
    }

    const progress = tracker.getProgress();
    const subTask = tracker.formatSubTask();

    // These should be compatible with statusManager.updatePhaseProgress
    expect(progress.percentage).toBe(50);
    expect(subTask).toBe('Processing frame 50/100 (50%)');

    // The status update would look like:
    // await updatePhaseProgress(uploadId, 2, 50, { subTask: 'Processing frame 50/100 (50%)' });
  });
});
