/**
 * ffmpeg.ts 並列化ロジックのテスト
 *
 * 実際のFFmpegやpLimitは呼び出さず、並列化のロジックのみをテストします。
 * p-limitはESMモジュールのため、ここではPromise.allのロジックのみテスト
 */

describe('FFmpeg Parallelization Logic', () => {
  describe('Scene Detection Parallelization', () => {
    it('should run multiple thresholds in parallel', async () => {
      const thresholds = [0.025, 0.055, 0.085];
      const executionOrder: number[] = [];

      // Simulate parallel execution
      const results = await Promise.all(
        thresholds.map(async (threshold, index) => {
          executionOrder.push(index);
          // Simulate some async work
          await new Promise(resolve => setTimeout(resolve, 10));
          return { threshold, cuts: [{ timestamp: index, confidence: threshold }] };
        })
      );

      expect(results.length).toBe(3);
      expect(results[0].threshold).toBe(0.025);
      expect(results[1].threshold).toBe(0.055);
      expect(results[2].threshold).toBe(0.085);
    });

    it('should merge results correctly after parallel execution', async () => {
      const thresholds = [0.025, 0.055, 0.085];

      // Simulate detection results from parallel execution
      const thresholdResults = await Promise.all(
        thresholds.map(async (threshold) => {
          // Simulate different cuts for each threshold
          const cuts = threshold === 0.025
            ? [{ timestamp: 1.0, confidence: 0.025 }, { timestamp: 5.0, confidence: 0.025 }]
            : threshold === 0.055
              ? [{ timestamp: 1.0, confidence: 0.055 }, { timestamp: 10.0, confidence: 0.055 }]
              : [{ timestamp: 1.0, confidence: 0.085 }];
          return { threshold, cuts };
        })
      );

      // Merge logic (same as in ffmpeg.ts)
      const allCuts = new Map<number, number>();
      thresholdResults.forEach(({ cuts }) => {
        cuts.forEach(cut => {
          const existingConfidence = allCuts.get(cut.timestamp) || 0;
          allCuts.set(cut.timestamp, Math.max(existingConfidence, cut.confidence));
        });
      });

      const mergedCuts = Array.from(allCuts.entries())
        .map(([timestamp, confidence]) => ({ timestamp, confidence }))
        .sort((a, b) => a.timestamp - b.timestamp);

      // Verify merged results
      expect(mergedCuts.length).toBe(3); // 1.0, 5.0, 10.0
      expect(mergedCuts[0]).toEqual({ timestamp: 1.0, confidence: 0.085 }); // Highest confidence wins
      expect(mergedCuts[1]).toEqual({ timestamp: 5.0, confidence: 0.025 });
      expect(mergedCuts[2]).toEqual({ timestamp: 10.0, confidence: 0.055 });
    });
  });

  describe('Concurrency Control Logic', () => {
    /**
     * Simple concurrency limiter for testing
     * Mimics p-limit behavior without ESM import issues
     */
    function createLimit(concurrency: number) {
      let activeCount = 0;
      const queue: (() => void)[] = [];

      const runNext = () => {
        if (queue.length > 0 && activeCount < concurrency) {
          activeCount++;
          const next = queue.shift()!;
          next();
        }
      };

      return <T>(fn: () => Promise<T>): Promise<T> => {
        return new Promise<T>((resolve, reject) => {
          const run = () => {
            fn()
              .then((result) => {
                activeCount--;
                runNext();
                resolve(result);
              })
              .catch((err) => {
                activeCount--;
                runNext();
                reject(err);
              });
          };

          queue.push(run);
          runNext();
        });
      };
    }

    it('should respect concurrency limit', async () => {
      const limit = createLimit(3);
      let currentConcurrency = 0;
      let maxConcurrency = 0;

      const frames = Array.from({ length: 10 }, (_, i) => i);

      await Promise.all(
        frames.map((frame) =>
          limit(async () => {
            currentConcurrency++;
            maxConcurrency = Math.max(maxConcurrency, currentConcurrency);

            await new Promise(resolve => setTimeout(resolve, 20));

            currentConcurrency--;
            return frame;
          })
        )
      );

      expect(maxConcurrency).toBeLessThanOrEqual(3);
    });

    it('should process all items even with concurrency limit', async () => {
      const limit = createLimit(5);
      const items = Array.from({ length: 20 }, (_, i) => i);
      const processedItems: number[] = [];

      await Promise.all(
        items.map((item) =>
          limit(async () => {
            await new Promise(resolve => setTimeout(resolve, 5));
            processedItems.push(item);
            return item;
          })
        )
      );

      expect(processedItems.length).toBe(20);
      expect(processedItems.sort((a, b) => a - b)).toEqual(items);
    });

    it('should handle errors in individual tasks', async () => {
      const limit = createLimit(3);
      const items = [0, 1, 2, 3, 4];
      const results: (number | Error)[] = [];

      await Promise.all(
        items.map((item) =>
          limit(async () => {
            await new Promise(resolve => setTimeout(resolve, 5));
            if (item === 2) {
              throw new Error('Task failed');
            }
            results.push(item);
            return item;
          }).catch((err) => {
            results.push(err);
          })
        )
      );

      expect(results.length).toBe(5);
      const errors = results.filter(r => r instanceof Error);
      expect(errors.length).toBe(1);
    });
  });

  describe('ROI Detection Parallelization', () => {
    it('should run all ROI regions in parallel', async () => {
      const regions = [
        { name: 'bottom_subtitle', crop: 'iw:ih*0.15:0:ih*0.85' },
        { name: 'center_text', crop: 'iw:ih*0.15:0:ih*0.425' },
        { name: 'top_left_logo', crop: 'iw*0.25:ih*0.1:0:0' },
        { name: 'top_right_info', crop: 'iw*0.25:ih*0.1:iw*0.75:0' },
      ];

      const startTime = Date.now();
      const roiResults = await Promise.all(
        regions.map(async (region) => {
          // Simulate 50ms detection per region
          await new Promise(resolve => setTimeout(resolve, 50));
          return { region, cuts: [{ timestamp: 1.0, confidence: 0.01 }] };
        })
      );
      const parallelTime = Date.now() - startTime;

      // If truly parallel, should complete in ~50ms, not 200ms
      expect(parallelTime).toBeLessThan(150);
      expect(roiResults.length).toBe(4);
    });

    it('should aggregate ROI results correctly', async () => {
      const regions = [
        { name: 'bottom_subtitle', crop: 'test1' },
        { name: 'top_left_logo', crop: 'test2' },
      ];

      const roiResults = await Promise.all(
        regions.map(async (region) => {
          const cuts = region.name === 'bottom_subtitle'
            ? [{ timestamp: 1.0, confidence: 0.01 }, { timestamp: 2.0, confidence: 0.015 }]
            : [{ timestamp: 1.5, confidence: 0.02 }];
          return { region, cuts };
        })
      );

      let allRoiCuts: { timestamp: number; confidence: number }[] = [];
      const roiRegionCounts: { [key: string]: number } = {};

      roiResults.forEach(({ region, cuts }) => {
        roiRegionCounts[region.name] = cuts.length;
        allRoiCuts = [...allRoiCuts, ...cuts];
      });

      expect(roiRegionCounts['bottom_subtitle']).toBe(2);
      expect(roiRegionCounts['top_left_logo']).toBe(1);
      expect(allRoiCuts.length).toBe(3);
    });
  });

  describe('Performance Comparison', () => {
    it('parallel execution should be faster than sequential', async () => {
      const tasks = Array.from({ length: 5 }, (_, i) => i);
      const taskDuration = 20;

      // Sequential execution
      const seqStart = Date.now();
      for (const _task of tasks) {
        await new Promise(resolve => setTimeout(resolve, taskDuration));
      }
      const seqTime = Date.now() - seqStart;

      // Parallel execution
      const parStart = Date.now();
      await Promise.all(
        tasks.map(() => new Promise(resolve => setTimeout(resolve, taskDuration)))
      );
      const parTime = Date.now() - parStart;

      // Parallel should be significantly faster
      expect(parTime).toBeLessThan(seqTime / 2);
    });
  });
});
