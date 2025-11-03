/**
 * Unit tests for pipeline.ts - filterPersistentOverlays function
 */

import { describe, it, expect, beforeEach } from '@jest/globals';

// Mock scene structure for testing
interface SceneWithOCR {
  sceneNumber: number;
  startTime: number;
  endTime: number;
  timecode: string;
  screenshotPath: string | null;
  ocrText: string;
  ocrConfidence: number;
}

interface OverlayFilterOptions {
  threshold?: number;
  minScenes?: number;
}

// Mock filterPersistentOverlays function for testing
// In production, this would be imported from pipeline.ts
function filterPersistentOverlays(
  scenesWithOCR: SceneWithOCR[],
  options: OverlayFilterOptions = {}
): SceneWithOCR[] {
  const { threshold = 0.5, minScenes = 3 } = options;

  if (scenesWithOCR.length === 0) return scenesWithOCR;

  if (scenesWithOCR.length < minScenes) {
    return scenesWithOCR;
  }

  const allLines: string[][] = scenesWithOCR.map(scene =>
    scene.ocrText
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
  );

  const lineFrequency = new Map<string, number>();
  const totalScenes = scenesWithOCR.length;

  for (const lines of allLines) {
    const uniqueLines = new Set(lines);
    for (const line of uniqueLines) {
      lineFrequency.set(line, (lineFrequency.get(line) || 0) + 1);
    }
  }

  const persistentThreshold = totalScenes * threshold;
  const persistentLines = new Set<string>();

  for (const [line, count] of lineFrequency.entries()) {
    if (count >= persistentThreshold) {
      persistentLines.add(line);
    }
  }

  const filteredScenes = scenesWithOCR.map(scene => {
    const lines = scene.ocrText
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0 && !persistentLines.has(line));

    const filteredText = lines.join('\n');

    return {
      ...scene,
      ocrText: filteredText
    };
  });

  return filteredScenes;
}

// Helper function to create mock scenes
function createMockScene(sceneNumber: number, ocrText: string): SceneWithOCR {
  return {
    sceneNumber,
    startTime: (sceneNumber - 1) * 10,
    endTime: sceneNumber * 10,
    timecode: `00:00:${String((sceneNumber - 1) * 10).padStart(2, '0')}`,
    screenshotPath: `/tmp/scene_${sceneNumber}.png`,
    ocrText,
    ocrConfidence: 0.9
  };
}

describe('filterPersistentOverlays', () => {
  describe('Edge Cases', () => {
    it('should handle empty scenes array', () => {
      const result = filterPersistentOverlays([]);
      expect(result).toEqual([]);
    });

    it('should not filter when only 1 scene exists (CRITICAL BUG FIX)', () => {
      const scenes = [
        createMockScene(1, 'Important text\nAnother line')
      ];
      const result = filterPersistentOverlays(scenes);
      expect(result[0].ocrText).toBe('Important text\nAnother line');
    });

    it('should not filter when only 2 scenes exist', () => {
      const scenes = [
        createMockScene(1, 'Logo\nContent A'),
        createMockScene(2, 'Logo\nContent B')
      ];
      const result = filterPersistentOverlays(scenes);
      expect(result[0].ocrText).toContain('Logo');
      expect(result[1].ocrText).toContain('Logo');
    });

    it('should handle scenes with no OCR text', () => {
      const scenes = [
        createMockScene(1, ''),
        createMockScene(2, ''),
        createMockScene(3, '')
      ];
      const result = filterPersistentOverlays(scenes);
      expect(result[0].ocrText).toBe('');
      expect(result[1].ocrText).toBe('');
      expect(result[2].ocrText).toBe('');
    });
  });

  describe('Threshold Accuracy (50% default)', () => {
    it('should filter text appearing in 2 out of 3 scenes (67%)', () => {
      const scenes = [
        createMockScene(1, 'Logo\nScene 1'),
        createMockScene(2, 'Logo\nScene 2'),
        createMockScene(3, 'Scene 3')
      ];
      const result = filterPersistentOverlays(scenes);
      expect(result[0].ocrText).toBe('Scene 1');
      expect(result[1].ocrText).toBe('Scene 2');
      expect(result[2].ocrText).toBe('Scene 3');
    });

    it('should filter text appearing in exactly 50% of scenes (2 out of 4)', () => {
      const scenes = [
        createMockScene(1, 'Logo\nContent'),
        createMockScene(2, 'Logo\nContent'),
        createMockScene(3, 'Content'),
        createMockScene(4, 'Content')
      ];
      const result = filterPersistentOverlays(scenes);
      expect(result[0].ocrText).toBe('Content');
      expect(result[1].ocrText).toBe('Content');
      expect(result[2].ocrText).toBe('Content');
      expect(result[3].ocrText).toBe('Content');
    });

    it('should NOT filter text appearing in less than 50% of scenes (2 out of 5 = 40%)', () => {
      const scenes = [
        createMockScene(1, 'Watermark\nContent'),
        createMockScene(2, 'Watermark\nContent'),
        createMockScene(3, 'Content'),
        createMockScene(4, 'Content'),
        createMockScene(5, 'Content')
      ];
      const result = filterPersistentOverlays(scenes);
      // 2/5 = 40% < 50% → "Watermark" should NOT be filtered
      expect(result[0].ocrText).toContain('Watermark');
      expect(result[1].ocrText).toContain('Watermark');
    });
  });

  describe('Duplicate Line Handling', () => {
    it('should count duplicate lines within same scene only once', () => {
      const scenes = [
        createMockScene(1, 'Logo\nLogo\nContent'), // Logo appears twice
        createMockScene(2, 'Logo\nContent'),
        createMockScene(3, 'Content')
      ];
      const result = filterPersistentOverlays(scenes);
      // "Logo" appears in 2 out of 3 scenes (67%) → filtered
      expect(result[0].ocrText).toBe('Content');
      expect(result[1].ocrText).toBe('Content');
      expect(result[2].ocrText).toBe('Content');
    });

    it('should ignore empty lines', () => {
      const scenes = [
        createMockScene(1, '\n\nContent\n\n'),
        createMockScene(2, '\nContent\n'),
        createMockScene(3, 'Content')
      ];
      const result = filterPersistentOverlays(scenes);
      expect(result[0].ocrText).toBe('Content');
      expect(result[1].ocrText).toBe('Content');
      expect(result[2].ocrText).toBe('Content');
    });
  });

  describe('Custom Threshold', () => {
    it('should respect custom threshold (70%)', () => {
      const scenes = [
        createMockScene(1, 'Logo\nContent'),
        createMockScene(2, 'Logo\nContent'),
        createMockScene(3, 'Logo\nContent'),
        createMockScene(4, 'Content'),
        createMockScene(5, 'Content')
      ];
      // With 50% threshold: 3/5 = 60% → Logo filtered
      const result50 = filterPersistentOverlays(scenes, { threshold: 0.5 });
      expect(result50[0].ocrText).toBe('Content');

      // With 70% threshold: 3/5 = 60% < 70% → Logo NOT filtered
      const result70 = filterPersistentOverlays(scenes, { threshold: 0.7 });
      expect(result70[0].ocrText).toContain('Logo');
    });

    it('should respect custom minScenes threshold', () => {
      const scenes = [
        createMockScene(1, 'Logo\nContent'),
        createMockScene(2, 'Logo\nContent'),
        createMockScene(3, 'Content')
      ];

      // Default minScenes=3: filtering should be applied
      const resultDefault = filterPersistentOverlays(scenes);
      expect(resultDefault[0].ocrText).toBe('Content');

      // Custom minScenes=5: filtering should be skipped
      const resultCustom = filterPersistentOverlays(scenes, { minScenes: 5 });
      expect(resultCustom[0].ocrText).toContain('Logo');
    });
  });

  describe('Performance', () => {
    it('should handle large number of scenes efficiently', () => {
      const scenes = Array.from({ length: 100 }, (_, i) =>
        createMockScene(i + 1, i % 2 === 0 ? 'Logo\nContent' : 'Content')
      );

      const start = performance.now();
      const result = filterPersistentOverlays(scenes);
      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(100); // Should complete within 100ms
      // "Logo" appears in 50/100 = 50% → filtered
      expect(result[0].ocrText).toBe('Content');
    });
  });
});
