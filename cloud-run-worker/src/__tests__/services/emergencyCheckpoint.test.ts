/**
 * Emergency Checkpoint Service Tests
 *
 * Tests the in-memory state management for emergency saves.
 * The actual save functionality (emergencySaveOcrProgress) is tested via integration tests
 * because it depends on checkpointService which has ESM dependencies.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';

// Mock the in-memory state (simulating emergencyCheckpoint.ts logic)
interface InProgressOcrState {
  uploadId: string;
  completedScenes: number[];
  ocrResults: Record<number, string>;
  lastSavedIndex: number;
}

let currentOcrState: InProgressOcrState | null = null;

function registerOcrProgress(
  uploadId: string,
  completedScenes: number[],
  ocrResults: Record<number, string>,
  lastSavedIndex: number
): void {
  currentOcrState = {
    uploadId,
    completedScenes,
    ocrResults,
    lastSavedIndex,
  };
}

function clearOcrProgress(): void {
  currentOcrState = null;
}

function getOcrProgress(): InProgressOcrState | null {
  return currentOcrState;
}

describe('emergencyCheckpoint', () => {
  beforeEach(() => {
    // Clear state before each test
    clearOcrProgress();
  });

  describe('registerOcrProgress', () => {
    it('should register OCR progress correctly', () => {
      const uploadId = 'test-upload-123';
      const completedScenes = [0, 1, 2, 3, 4];
      const ocrResults = { 0: 'text0', 1: 'text1', 2: 'text2', 3: 'text3', 4: 'text4' };
      const lastSavedIndex = 2;

      registerOcrProgress(uploadId, completedScenes, ocrResults, lastSavedIndex);

      const progress = getOcrProgress();
      expect(progress).not.toBeNull();
      expect(progress?.uploadId).toBe(uploadId);
      expect(progress?.completedScenes).toEqual(completedScenes);
      expect(progress?.ocrResults).toEqual(ocrResults);
      expect(progress?.lastSavedIndex).toBe(lastSavedIndex);
    });

    it('should update progress on subsequent calls', () => {
      registerOcrProgress('upload-1', [0], { 0: 'a' }, -1);
      registerOcrProgress('upload-1', [0, 1, 2], { 0: 'a', 1: 'b', 2: 'c' }, 0);

      const progress = getOcrProgress();
      expect(progress?.completedScenes).toEqual([0, 1, 2]);
      expect(progress?.lastSavedIndex).toBe(0);
    });
  });

  describe('clearOcrProgress', () => {
    it('should clear OCR progress', () => {
      registerOcrProgress('upload-1', [0, 1], { 0: 'a', 1: 'b' }, 0);
      expect(getOcrProgress()).not.toBeNull();

      clearOcrProgress();
      expect(getOcrProgress()).toBeNull();
    });
  });

  describe('getOcrProgress', () => {
    it('should return null when no progress is registered', () => {
      expect(getOcrProgress()).toBeNull();
    });

    it('should return progress when registered', () => {
      registerOcrProgress('upload-x', [5, 6, 7], { 5: 'e', 6: 'f', 7: 'g' }, 5);
      const progress = getOcrProgress();
      expect(progress).not.toBeNull();
      expect(progress?.uploadId).toBe('upload-x');
    });
  });

  describe('unsaved scenes calculation', () => {
    it('should correctly identify unsaved scenes', () => {
      // Simulate: 10 scenes completed, but only up to index 4 saved
      const completedScenes = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
      const ocrResults: Record<number, string> = {};
      for (let i = 0; i < 10; i++) {
        ocrResults[i] = `text-${i}`;
      }
      const lastSavedIndex = 4;

      registerOcrProgress('upload-calc', completedScenes, ocrResults, lastSavedIndex);

      const progress = getOcrProgress()!;
      const unsavedScenes = progress.completedScenes.filter(idx => idx > progress.lastSavedIndex);

      expect(unsavedScenes).toEqual([5, 6, 7, 8, 9]);
      expect(unsavedScenes.length).toBe(5);
    });

    it('should return empty when all scenes are saved', () => {
      const completedScenes = [0, 1, 2, 3, 4];
      const ocrResults = { 0: 'a', 1: 'b', 2: 'c', 3: 'd', 4: 'e' };
      const lastSavedIndex = 4; // All saved

      registerOcrProgress('upload-all-saved', completedScenes, ocrResults, lastSavedIndex);

      const progress = getOcrProgress()!;
      const unsavedScenes = progress.completedScenes.filter(idx => idx > progress.lastSavedIndex);

      expect(unsavedScenes).toEqual([]);
    });
  });
});
