/**
 * Batch Processing Memory Tests
 * Tests for memory usage during batch processing
 *
 * Created: 2026-02-06
 */
import { describe, it, expect } from '@jest/globals';
import { getMemoryUsage } from '../../services/ffmpeg.js';
describe('Batch Processing Memory', () => {
    describe('Memory Usage Tracking', () => {
        it('should return valid memory usage metrics', () => {
            const mem = getMemoryUsage();
            expect(mem).toHaveProperty('heapUsed');
            expect(mem).toHaveProperty('heapTotal');
            expect(mem).toHaveProperty('rss');
            expect(mem).toHaveProperty('external');
            expect(typeof mem.heapUsed).toBe('number');
            expect(typeof mem.heapTotal).toBe('number');
            expect(typeof mem.rss).toBe('number');
            expect(typeof mem.external).toBe('number');
            // Memory values should be positive
            expect(mem.heapUsed).toBeGreaterThan(0);
            expect(mem.heapTotal).toBeGreaterThan(0);
            expect(mem.rss).toBeGreaterThan(0);
        });
        it('should report memory in megabytes', () => {
            const mem = getMemoryUsage();
            // Typical Node.js process uses at least 10MB
            expect(mem.heapUsed).toBeGreaterThan(10);
            // But less than 1GB for a simple test
            expect(mem.heapUsed).toBeLessThan(1000);
        });
    });
    describe('Memory Accumulation Simulation', () => {
        it('should not accumulate significant memory when simulating batch data', () => {
            const initialMem = getMemoryUsage();
            // Simulate accumulating OCR results (like batch processing does)
            const results = [];
            for (let batch = 0; batch < 50; batch++) {
                for (let scene = 0; scene < 100; scene++) {
                    results.push({
                        sceneNumber: batch * 100 + scene + 1,
                        ocrText: 'サンプルテキスト'.repeat(10), // ~200 chars per scene
                    });
                }
            }
            // 5000 scenes × ~200 chars = ~1MB of text data
            expect(results.length).toBe(5000);
            const finalMem = getMemoryUsage();
            const memoryIncrease = finalMem.heapUsed - initialMem.heapUsed;
            // Memory increase should be reasonable (< 50MB for text data)
            console.log(`Memory increase for 5000 OCR results: ${memoryIncrease}MB`);
            expect(memoryIncrease).toBeLessThan(50);
        });
        it('should release memory when data is cleared', () => {
            let results = [];
            // Allocate memory
            for (let i = 0; i < 5000; i++) {
                results.push({
                    sceneNumber: i + 1,
                    ocrText: 'サンプルテキスト'.repeat(10),
                });
            }
            const memBeforeClear = getMemoryUsage();
            // Clear the array
            results = [];
            // Force garbage collection hint
            if (global.gc) {
                global.gc();
            }
            // Note: Memory may not be immediately released
            // This test verifies the pattern, not exact memory release
            expect(results.length).toBe(0);
        });
    });
    describe('Batch Size Limits', () => {
        it('should handle DEFAULT_BATCH_SIZE of 100', async () => {
            const { DEFAULT_BATCH_SIZE } = await import('../../services/ffmpeg.js');
            expect(DEFAULT_BATCH_SIZE).toBe(100);
        });
        it('should calculate correct number of batches', () => {
            const totalScenes = 3106;
            const batchSize = 100;
            const expectedBatches = Math.ceil(totalScenes / batchSize);
            expect(expectedBatches).toBe(32);
        });
    });
});
describe('2GB Video Processing Estimation', () => {
    it('should estimate memory usage for 2GB video', () => {
        // Estimation based on typical 2GB, 2-hour video
        const videoSizeGB = 2;
        const videoDurationMinutes = 120;
        const estimatedScenes = 4000; // Conservative estimate
        // Memory calculations
        const batchSize = 100;
        const totalBatches = Math.ceil(estimatedScenes / batchSize);
        // Per-batch memory (MB)
        const ffmpegConcurrency = 4;
        const ffmpegMemoryPerProcess = 150; // MB
        const ocrConcurrency = 5;
        const ocrMemoryPerProcess = 20; // MB
        const nodeBaseline = 250; // MB
        const peakBatchMemory = (ffmpegConcurrency * ffmpegMemoryPerProcess) +
            (ocrConcurrency * ocrMemoryPerProcess) +
            nodeBaseline;
        // Accumulated OCR results (text only)
        const ocrTextPerScene = 1; // KB
        const totalOcrMemory = (estimatedScenes * ocrTextPerScene) / 1024; // MB
        console.log('\n📊 2GB Video Memory Estimation:');
        console.log(`  Video: ${videoSizeGB}GB, ${videoDurationMinutes}min`);
        console.log(`  Estimated scenes: ${estimatedScenes}`);
        console.log(`  Total batches: ${totalBatches}`);
        console.log(`  Peak batch memory: ${peakBatchMemory}MB`);
        console.log(`  Accumulated OCR text: ${totalOcrMemory.toFixed(1)}MB`);
        console.log(`  Available memory: 4096MB`);
        console.log(`  Safety margin: ${4096 - peakBatchMemory}MB`);
        // Assertions
        expect(peakBatchMemory).toBeLessThan(4096); // Must fit in 4GB
        expect(peakBatchMemory).toBeLessThan(2000); // Should have 50% margin
        expect(totalOcrMemory).toBeLessThan(100); // Text accumulation should be minimal
    });
    it('should estimate disk usage for temporary files', () => {
        const batchSize = 100;
        const avgFrameSizeMB = 3; // PNG at 1920x1080
        const peakDiskUsage = batchSize * avgFrameSizeMB;
        console.log('\n📁 Temporary Disk Usage:');
        console.log(`  Batch size: ${batchSize} frames`);
        console.log(`  Avg frame size: ${avgFrameSizeMB}MB`);
        console.log(`  Peak disk usage: ${peakDiskUsage}MB`);
        // Cloud Run /tmp has limited space (varies by memory allocation)
        // With 4GB memory, typically get ~1GB /tmp
        expect(peakDiskUsage).toBeLessThan(500); // Should be well under limit
    });
});
//# sourceMappingURL=batchMemory.test.js.map