/**
 * Unit tests for videoProcessor.ts - compressVideoIfNeeded function
 *
 * Test Coverage:
 * - Skip compression for files under 200MB threshold
 * - Compress files over 200MB threshold
 * - Handle compression errors gracefully
 * - File size validation
 * - FFmpeg error scenarios
 * - File system operations (replace original with compressed)
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import type { Stats } from 'fs';

// Mock dependencies
const mockStatSync = jest.fn<(path: string) => Stats>();
const mockExistsSync = jest.fn<(path: string) => boolean>();
const mockUnlinkSync = jest.fn<(path: string) => void>();
const mockRenameSync = jest.fn<(oldPath: string, newPath: string) => void>();
const mockExecFileAsync = jest.fn<(file: string, args: string[], options?: any) => Promise<{ stdout: string; stderr: string }>>();

// Mock modules
jest.mock('fs', () => ({
  statSync: mockStatSync,
  existsSync: mockExistsSync,
  unlinkSync: mockUnlinkSync,
  renameSync: mockRenameSync,
}));

jest.mock('util', () => ({
  promisify: jest.fn(() => mockExecFileAsync),
}));

// Import the function under test (compressVideoIfNeeded is not exported, so we need to test it indirectly)
// For testing purposes, we'll create a copy of the function
// In production, this would be extracted to a separate module

interface CompressionResult {
  compressed: boolean;
  originalSize: number;
  newSize: number;
}

/**
 * Copy of compressVideoIfNeeded for testing
 * In production, this would be imported from videoProcessor.ts
 */
async function compressVideoIfNeeded(
  inputPath: string,
  uploadId: string
): Promise<CompressionResult> {
  const fs = await import('fs');
  const { promisify } = await import('util');
  const { execFile } = await import('child_process');
  const execFileAsync = promisify(execFile);

  const COMPRESSION_THRESHOLD = 200 * 1024 * 1024; // 200MB in bytes

  // Check file size
  const stats = fs.statSync(inputPath);
  const originalSize = stats.size;

  if (originalSize < COMPRESSION_THRESHOLD) {
    console.log(`[${uploadId}] File size ${(originalSize / 1024 / 1024).toFixed(1)}MB is under ${COMPRESSION_THRESHOLD / 1024 / 1024}MB threshold, skipping compression`);
    return { compressed: false, originalSize, newSize: originalSize };
  }

  console.log(`[${uploadId}] File size ${(originalSize / 1024 / 1024).toFixed(1)}MB exceeds threshold, starting compression...`);

  // Create temporary output path
  const outputPath = inputPath.replace('.mp4', '_compressed.mp4');

  try {
    const startTime = Date.now();

    // Execute ffmpeg compression
    const ffmpegArgs = [
      '-i', inputPath,
      '-vcodec', 'libx264',
      '-crf', '28',
      '-preset', 'fast',
      '-acodec', 'aac',
      '-b:a', '96k',
      '-movflags', '+faststart',
      '-y',
      outputPath
    ];

    console.log(`[${uploadId}] Running ffmpeg compression (CRF 28, fast preset)...`);

    const { stdout, stderr } = await execFileAsync('ffmpeg', ffmpegArgs, {
      maxBuffer: 10 * 1024 * 1024 // 10MB buffer for ffmpeg output
    });

    const endTime = Date.now();
    const durationSec = ((endTime - startTime) / 1000).toFixed(1);

    // Check output file
    if (!fs.existsSync(outputPath)) {
      throw new Error('Compression completed but output file not found');
    }

    const compressedStats = fs.statSync(outputPath);
    const newSize = compressedStats.size;

    console.log(`[${uploadId}] Compression completed in ${durationSec}s`);

    // Replace original file with compressed version
    fs.unlinkSync(inputPath);
    fs.renameSync(outputPath, inputPath);

    console.log(`[${uploadId}] Replaced original file with compressed version`);

    return { compressed: true, originalSize, newSize };

  } catch (error) {
    // Clean up temporary file if it exists
    if (fs.existsSync(outputPath)) {
      fs.unlinkSync(outputPath);
    }

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[${uploadId}] Compression failed: ${errorMessage}`);
    throw error;
  }
}

// Helper function to create mock Stats object
function createMockStats(size: number): Stats {
  return {
    size,
    isFile: () => true,
    isDirectory: () => false,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isSymbolicLink: () => false,
    isFIFO: () => false,
    isSocket: () => false,
    dev: 0,
    ino: 0,
    mode: 0,
    nlink: 0,
    uid: 0,
    gid: 0,
    rdev: 0,
    blksize: 0,
    blocks: 0,
    atimeMs: 0,
    mtimeMs: 0,
    ctimeMs: 0,
    birthtimeMs: 0,
    atime: new Date(),
    mtime: new Date(),
    ctime: new Date(),
    birthtime: new Date(),
  } as Stats;
}

describe('compressVideoIfNeeded', () => {
  const mockUploadId = 'test_upload_123';
  const mockInputPath = '/tmp/test_video.mp4';
  const mockOutputPath = '/tmp/test_video_compressed.mp4';

  beforeEach(() => {
    // Clear all mocks before each test
    jest.clearAllMocks();

    // Suppress console.log for cleaner test output (optional)
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    // Restore console
    jest.restoreAllMocks();
  });

  describe('File size threshold checks', () => {
    it('should skip compression for files under 200MB threshold', async () => {
      // Setup: File is 100MB (under 200MB threshold)
      const fileSizeBytes = 100 * 1024 * 1024;
      mockStatSync.mockReturnValueOnce(createMockStats(fileSizeBytes));

      // Execute
      const result = await compressVideoIfNeeded(mockInputPath, mockUploadId);

      // Assert
      expect(result.compressed).toBe(false);
      expect(result.originalSize).toBe(fileSizeBytes);
      expect(result.newSize).toBe(fileSizeBytes);
      expect(mockExecFileAsync).not.toHaveBeenCalled();
      expect(mockStatSync).toHaveBeenCalledTimes(1);
      expect(mockStatSync).toHaveBeenCalledWith(mockInputPath);
    });

    it('should skip compression for files exactly at 200MB threshold', async () => {
      // Setup: File is exactly 200MB
      const fileSizeBytes = 200 * 1024 * 1024;
      mockStatSync.mockReturnValueOnce(createMockStats(fileSizeBytes));

      // Execute
      const result = await compressVideoIfNeeded(mockInputPath, mockUploadId);

      // Assert
      expect(result.compressed).toBe(false);
      expect(result.originalSize).toBe(fileSizeBytes);
      expect(result.newSize).toBe(fileSizeBytes);
      expect(mockExecFileAsync).not.toHaveBeenCalled();
    });

    it('should skip compression for very small files (1MB)', async () => {
      // Setup: File is 1MB
      const fileSizeBytes = 1 * 1024 * 1024;
      mockStatSync.mockReturnValueOnce(createMockStats(fileSizeBytes));

      // Execute
      const result = await compressVideoIfNeeded(mockInputPath, mockUploadId);

      // Assert
      expect(result.compressed).toBe(false);
      expect(result.originalSize).toBe(fileSizeBytes);
      expect(result.newSize).toBe(fileSizeBytes);
    });

    it('should skip compression for empty files (0 bytes)', async () => {
      // Setup: File is 0 bytes
      const fileSizeBytes = 0;
      mockStatSync.mockReturnValueOnce(createMockStats(fileSizeBytes));

      // Execute
      const result = await compressVideoIfNeeded(mockInputPath, mockUploadId);

      // Assert
      expect(result.compressed).toBe(false);
      expect(result.originalSize).toBe(0);
      expect(result.newSize).toBe(0);
    });
  });

  describe('Compression for large files', () => {
    it('should compress files over 200MB threshold', async () => {
      // Setup: File is 300MB (over 200MB threshold)
      const originalSizeBytes = 300 * 1024 * 1024;
      const compressedSizeBytes = 150 * 1024 * 1024; // 50% compression

      // Mock fs.statSync calls (original size, then compressed size)
      mockStatSync
        .mockReturnValueOnce(createMockStats(originalSizeBytes))
        .mockReturnValueOnce(createMockStats(compressedSizeBytes));

      // Mock ffmpeg execution
      mockExecFileAsync.mockResolvedValueOnce({
        stdout: '',
        stderr: 'ffmpeg version...',
      });

      // Mock file existence check
      mockExistsSync.mockReturnValueOnce(true);

      // Execute
      const result = await compressVideoIfNeeded(mockInputPath, mockUploadId);

      // Assert
      expect(result.compressed).toBe(true);
      expect(result.originalSize).toBe(originalSizeBytes);
      expect(result.newSize).toBe(compressedSizeBytes);

      // Verify ffmpeg was called with correct arguments
      expect(mockExecFileAsync).toHaveBeenCalledTimes(1);
      expect(mockExecFileAsync).toHaveBeenCalledWith(
        'ffmpeg',
        [
          '-i', mockInputPath,
          '-vcodec', 'libx264',
          '-crf', '28',
          '-preset', 'fast',
          '-acodec', 'aac',
          '-b:a', '96k',
          '-movflags', '+faststart',
          '-y',
          mockOutputPath,
        ],
        { maxBuffer: 10 * 1024 * 1024 }
      );

      // Verify file operations
      expect(mockExistsSync).toHaveBeenCalledWith(mockOutputPath);
      expect(mockUnlinkSync).toHaveBeenCalledWith(mockInputPath);
      expect(mockRenameSync).toHaveBeenCalledWith(mockOutputPath, mockInputPath);
    });

    it('should compress files just over 200MB threshold (201MB)', async () => {
      // Setup: File is 201MB (just over threshold)
      const originalSizeBytes = 201 * 1024 * 1024;
      const compressedSizeBytes = 100 * 1024 * 1024;

      mockStatSync
        .mockReturnValueOnce(createMockStats(originalSizeBytes))
        .mockReturnValueOnce(createMockStats(compressedSizeBytes));

      mockExecFileAsync.mockResolvedValueOnce({
        stdout: '',
        stderr: 'ffmpeg version...',
      });

      mockExistsSync.mockReturnValueOnce(true);

      // Execute
      const result = await compressVideoIfNeeded(mockInputPath, mockUploadId);

      // Assert
      expect(result.compressed).toBe(true);
      expect(result.originalSize).toBe(originalSizeBytes);
      expect(result.newSize).toBe(compressedSizeBytes);
      expect(mockExecFileAsync).toHaveBeenCalledTimes(1);
    });

    it('should compress very large files (500MB)', async () => {
      // Setup: File is 500MB
      const originalSizeBytes = 500 * 1024 * 1024;
      const compressedSizeBytes = 200 * 1024 * 1024; // 60% compression

      mockStatSync
        .mockReturnValueOnce(createMockStats(originalSizeBytes))
        .mockReturnValueOnce(createMockStats(compressedSizeBytes));

      mockExecFileAsync.mockResolvedValueOnce({
        stdout: '',
        stderr: 'ffmpeg version...',
      });

      mockExistsSync.mockReturnValueOnce(true);

      // Execute
      const result = await compressVideoIfNeeded(mockInputPath, mockUploadId);

      // Assert
      expect(result.compressed).toBe(true);
      expect(result.originalSize).toBe(originalSizeBytes);
      expect(result.newSize).toBe(compressedSizeBytes);
    });
  });

  describe('Error handling', () => {
    it('should throw error when ffmpeg fails', async () => {
      // Setup: File is 300MB
      const originalSizeBytes = 300 * 1024 * 1024;
      mockStatSync.mockReturnValueOnce(createMockStats(originalSizeBytes));

      // Mock ffmpeg failure
      const ffmpegError = new Error('FFmpeg encoding error: invalid codec');
      mockExecFileAsync.mockRejectedValueOnce(ffmpegError);

      // Mock file existence (for cleanup)
      mockExistsSync.mockReturnValueOnce(true);

      // Execute & Assert
      await expect(
        compressVideoIfNeeded(mockInputPath, mockUploadId)
      ).rejects.toThrow('FFmpeg encoding error: invalid codec');

      // Verify cleanup was attempted
      expect(mockExistsSync).toHaveBeenCalledWith(mockOutputPath);
      expect(mockUnlinkSync).toHaveBeenCalledWith(mockOutputPath);
    });

    it('should throw error when output file is not created', async () => {
      // Setup: File is 300MB
      const originalSizeBytes = 300 * 1024 * 1024;
      mockStatSync.mockReturnValueOnce(createMockStats(originalSizeBytes));

      // Mock ffmpeg success
      mockExecFileAsync.mockResolvedValueOnce({
        stdout: '',
        stderr: 'ffmpeg version...',
      });

      // Mock output file does not exist
      mockExistsSync.mockReturnValueOnce(false);

      // Execute & Assert
      await expect(
        compressVideoIfNeeded(mockInputPath, mockUploadId)
      ).rejects.toThrow('Compression completed but output file not found');

      // Verify ffmpeg was called
      expect(mockExecFileAsync).toHaveBeenCalledTimes(1);
    });

    it('should cleanup temporary file on ffmpeg error', async () => {
      // Setup: File is 300MB
      const originalSizeBytes = 300 * 1024 * 1024;
      mockStatSync.mockReturnValueOnce(createMockStats(originalSizeBytes));

      // Mock ffmpeg failure
      mockExecFileAsync.mockRejectedValueOnce(new Error('FFmpeg timeout'));

      // Mock temporary file exists (needs cleanup)
      mockExistsSync.mockReturnValueOnce(true);

      // Execute & Assert
      await expect(
        compressVideoIfNeeded(mockInputPath, mockUploadId)
      ).rejects.toThrow('FFmpeg timeout');

      // Verify cleanup
      expect(mockExistsSync).toHaveBeenCalledWith(mockOutputPath);
      expect(mockUnlinkSync).toHaveBeenCalledWith(mockOutputPath);

      // Verify original file was NOT touched
      expect(mockRenameSync).not.toHaveBeenCalled();
    });

    it('should handle non-Error objects thrown by ffmpeg', async () => {
      // Setup: File is 300MB
      const originalSizeBytes = 300 * 1024 * 1024;
      mockStatSync.mockReturnValueOnce(createMockStats(originalSizeBytes));

      // Mock ffmpeg throws non-Error object
      mockExecFileAsync.mockRejectedValueOnce('Unknown error string');

      // Mock file doesn't exist (no cleanup needed)
      mockExistsSync.mockReturnValueOnce(false);

      // Execute & Assert
      await expect(
        compressVideoIfNeeded(mockInputPath, mockUploadId)
      ).rejects.toBe('Unknown error string');

      // Verify error was logged (console.error was mocked)
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining(`[${mockUploadId}] Compression failed: Unknown error`)
      );
    });

    it('should not cleanup if temporary file does not exist on error', async () => {
      // Setup: File is 300MB
      const originalSizeBytes = 300 * 1024 * 1024;
      mockStatSync.mockReturnValueOnce(createMockStats(originalSizeBytes));

      // Mock ffmpeg failure
      mockExecFileAsync.mockRejectedValueOnce(new Error('FFmpeg crash'));

      // Mock temporary file does not exist
      mockExistsSync.mockReturnValueOnce(false);

      // Execute & Assert
      await expect(
        compressVideoIfNeeded(mockInputPath, mockUploadId)
      ).rejects.toThrow('FFmpeg crash');

      // Verify cleanup was NOT attempted (file doesn't exist)
      expect(mockExistsSync).toHaveBeenCalledWith(mockOutputPath);
      expect(mockUnlinkSync).not.toHaveBeenCalled();
    });
  });

  describe('File operations', () => {
    it('should replace original file with compressed version', async () => {
      // Setup: File is 300MB, compresses to 150MB
      const originalSizeBytes = 300 * 1024 * 1024;
      const compressedSizeBytes = 150 * 1024 * 1024;

      mockStatSync
        .mockReturnValueOnce(createMockStats(originalSizeBytes))
        .mockReturnValueOnce(createMockStats(compressedSizeBytes));

      mockExecFileAsync.mockResolvedValueOnce({
        stdout: '',
        stderr: '',
      });

      mockExistsSync.mockReturnValueOnce(true);

      // Execute
      await compressVideoIfNeeded(mockInputPath, mockUploadId);

      // Assert: Verify correct sequence of file operations
      expect(mockUnlinkSync).toHaveBeenCalledWith(mockInputPath);
      expect(mockRenameSync).toHaveBeenCalledWith(mockOutputPath, mockInputPath);

      // Verify order: unlink original before rename
      const unlinkCall = (mockUnlinkSync.mock as any).invocationCallOrder[0];
      const renameCall = (mockRenameSync.mock as any).invocationCallOrder[0];
      expect(unlinkCall).toBeLessThan(renameCall);
    });

    it('should read compressed file size after ffmpeg completes', async () => {
      // Setup: File is 300MB, compresses to 150MB
      const originalSizeBytes = 300 * 1024 * 1024;
      const compressedSizeBytes = 150 * 1024 * 1024;

      mockStatSync
        .mockReturnValueOnce(createMockStats(originalSizeBytes))
        .mockReturnValueOnce(createMockStats(compressedSizeBytes));

      mockExecFileAsync.mockResolvedValueOnce({
        stdout: '',
        stderr: '',
      });

      mockExistsSync.mockReturnValueOnce(true);

      // Execute
      const result = await compressVideoIfNeeded(mockInputPath, mockUploadId);

      // Assert: Verify statSync was called twice (original + compressed)
      expect(mockStatSync).toHaveBeenCalledTimes(2);
      expect(mockStatSync).toHaveBeenNthCalledWith(1, mockInputPath);
      expect(mockStatSync).toHaveBeenNthCalledWith(2, mockOutputPath);
      expect(result.newSize).toBe(compressedSizeBytes);
    });
  });

  describe('Logging behavior', () => {
    it('should log skip message for small files', async () => {
      // Setup: File is 100MB
      const fileSizeBytes = 100 * 1024 * 1024;
      mockStatSync.mockReturnValueOnce(createMockStats(fileSizeBytes));

      // Execute
      await compressVideoIfNeeded(mockInputPath, mockUploadId);

      // Assert: Verify log message
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining(`[${mockUploadId}] File size 100.0MB is under 200MB threshold, skipping compression`)
      );
    });

    it('should log compression start for large files', async () => {
      // Setup: File is 300MB
      const originalSizeBytes = 300 * 1024 * 1024;
      const compressedSizeBytes = 150 * 1024 * 1024;

      mockStatSync
        .mockReturnValueOnce(createMockStats(originalSizeBytes))
        .mockReturnValueOnce(createMockStats(compressedSizeBytes));

      mockExecFileAsync.mockResolvedValueOnce({
        stdout: '',
        stderr: '',
      });

      mockExistsSync.mockReturnValueOnce(true);

      // Execute
      await compressVideoIfNeeded(mockInputPath, mockUploadId);

      // Assert: Verify compression logs
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining(`[${mockUploadId}] File size 300.0MB exceeds threshold, starting compression...`)
      );
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining(`[${mockUploadId}] Running ffmpeg compression (CRF 28, fast preset)...`)
      );
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining(`[${mockUploadId}] Compression completed in`)
      );
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining(`[${mockUploadId}] Replaced original file with compressed version`)
      );
    });

    it('should log error message on compression failure', async () => {
      // Setup: File is 300MB
      const originalSizeBytes = 300 * 1024 * 1024;
      mockStatSync.mockReturnValueOnce(createMockStats(originalSizeBytes));

      // Mock ffmpeg failure
      const errorMessage = 'FFmpeg encoding failed: invalid parameters';
      mockExecFileAsync.mockRejectedValueOnce(new Error(errorMessage));

      mockExistsSync.mockReturnValueOnce(true);

      // Execute & Assert
      await expect(
        compressVideoIfNeeded(mockInputPath, mockUploadId)
      ).rejects.toThrow(errorMessage);

      // Verify error log
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining(`[${mockUploadId}] Compression failed: ${errorMessage}`)
      );
    });
  });
});
