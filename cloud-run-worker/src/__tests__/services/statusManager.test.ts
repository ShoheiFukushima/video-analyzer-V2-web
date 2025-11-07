/**
 * Unit tests for statusManager.ts
 *
 * Focus areas:
 * - handleSupabaseError() with different error codes
 * - mapDbRowToStatus() type mapping (snake_case to camelCase)
 * - initStatus() basic functionality with mocked Supabase
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  ProcessingStatus,
  SupabaseError,
  SupabaseStatusRow,
} from '../../types/shared.js';

// Mock dependencies
jest.mock('dotenv', () => ({
  config: jest.fn(),
}), { virtual: true });

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(),
}));

// Set environment variables before importing statusManager
process.env.NODE_ENV = 'production';
process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
process.env.USE_SUPABASE = 'true';

describe('statusManager', () => {
  let mockFrom: any;
  let mockUpsert: any;
  let mockUpdate: any;
  let mockSelect: any;
  let mockEq: any;
  let mockSingle: any;
  let statusManager: typeof import('../../services/statusManager.js');

  beforeEach(async () => {
    // Reset modules to get fresh imports
    jest.resetModules();

    // Create mock chain for Supabase fluent API
    mockSingle = jest.fn();
    mockEq = jest.fn().mockReturnValue({ single: mockSingle });
    mockSelect = jest.fn().mockReturnValue({ eq: mockEq, single: mockSingle });
    mockUpsert = jest.fn().mockReturnValue({ select: mockSelect, single: mockSingle });
    mockUpdate = jest.fn().mockReturnValue({ eq: mockEq, select: mockSelect, single: mockSingle });
    mockFrom = jest.fn().mockReturnValue({
      upsert: mockUpsert,
      update: mockUpdate,
      select: mockSelect,
      eq: mockEq,
      single: mockSingle,
    });

    // Create mock Supabase client
    const mockSupabaseClient = {
      from: mockFrom,
    };

    // Mock createClient to return our mock
    const { createClient } = await import('@supabase/supabase-js');
    (createClient as jest.MockedFunction<typeof createClient>).mockReturnValue(
      mockSupabaseClient as any
    );

    // Import statusManager after mocks are set up
    statusManager = await import('../../services/statusManager.js');
  });

  describe('Error Handling - handleSupabaseError()', () => {
    /**
     * Test PGRST205 error code (Schema cache issue)
     */
    it('should throw descriptive error for PGRST205 (schema cache issue)', async () => {
      const error: SupabaseError = {
        code: 'PGRST205',
        message: 'Could not find the processing_status table',
        details: 'relation "public.processing_status" does not exist',
        hint: 'Reload schema cache',
      };

      // Mock upsert to return PGRST205 error
      mockSingle.mockResolvedValue({
        data: null,
        error,
      });

      await expect(
        statusManager.initStatus('test-upload-id', 'user-123')
      ).rejects.toThrow(
        /Supabase schema cache error: Table 'processing_status' not found in cache/
      );
    });

    /**
     * Test PGRST116 error code (No rows returned)
     */
    it('should throw descriptive error for PGRST116 (no rows returned)', async () => {
      const error: SupabaseError = {
        code: 'PGRST116',
        message: 'No rows returned',
        details: 'Query returned no rows',
      };

      // Mock upsert to return PGRST116 error
      mockSingle.mockResolvedValue({
        data: null,
        error,
      });

      await expect(
        statusManager.initStatus('test-upload-id', 'user-123')
      ).rejects.toThrow(/No rows returned for upload_id: test-upload-id/);
    });

    /**
     * Test 42501 error code (RLS permission denied)
     */
    it('should throw descriptive error for 42501 (RLS violation)', async () => {
      const error: SupabaseError = {
        code: '42501',
        message: 'Permission denied for table processing_status',
        details: 'Row-level security policy violation',
      };

      // Mock upsert to return RLS error
      mockSingle.mockResolvedValue({
        data: null,
        error,
      });

      await expect(
        statusManager.initStatus('test-upload-id', 'user-123')
      ).rejects.toThrow(/Permission denied: Row-level security policy violation/);
    });

    /**
     * Test generic error (unknown error code)
     */
    it('should throw generic error for unknown error codes', async () => {
      const error: SupabaseError = {
        code: 'UNKNOWN_CODE',
        message: 'Something went wrong',
      };

      // Mock upsert to return generic error
      mockSingle.mockResolvedValue({
        data: null,
        error,
      });

      await expect(
        statusManager.initStatus('test-upload-id', 'user-123')
      ).rejects.toThrow(/Supabase initStatus failed: Something went wrong/);
    });
  });

  describe('Type Mapping - mapDbRowToStatus()', () => {
    /**
     * Test snake_case to camelCase conversion
     */
    it('should correctly map snake_case database row to camelCase ProcessingStatus', async () => {
      const mockDbRow: SupabaseStatusRow = {
        upload_id: 'upload-123',
        user_id: 'user-456',
        status: 'processing',
        progress: 50,
        stage: 'audio',
        started_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-01T00:05:00Z',
        result_url: 'https://example.com/result.xlsx',
        metadata: {
          duration: 120,
          segmentCount: 10,
          ocrResultCount: 5,
          transcriptionLength: 1000,
        },
        error: undefined,
      };

      // Mock successful upsert that returns the db row
      mockSingle.mockResolvedValue({
        data: mockDbRow,
        error: null,
      });

      const result = await statusManager.initStatus('upload-123', 'user-456');

      // Verify camelCase conversion
      expect(result).toEqual({
        uploadId: 'upload-123',
        userId: 'user-456',
        status: 'processing',
        progress: 50,
        stage: 'audio',
        startedAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:05:00Z',
        resultUrl: 'https://example.com/result.xlsx',
        metadata: {
          duration: 120,
          segmentCount: 10,
          ocrResultCount: 5,
          transcriptionLength: 1000,
        },
        error: undefined,
      } as ProcessingStatus);
    });

    /**
     * Test optional fields handling (undefined values)
     */
    it('should handle optional fields correctly (undefined values)', async () => {
      const mockDbRow: SupabaseStatusRow = {
        upload_id: 'upload-789',
        user_id: 'user-999',
        status: 'pending',
        progress: 0,
        stage: 'downloading',
        started_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-01T00:00:00Z',
        // Optional fields omitted
        result_url: undefined,
        metadata: undefined,
        error: undefined,
      };

      // Mock successful upsert
      mockSingle.mockResolvedValue({
        data: mockDbRow,
        error: null,
      });

      const result = await statusManager.initStatus('upload-789', 'user-999');

      expect(result).toEqual({
        uploadId: 'upload-789',
        userId: 'user-999',
        status: 'pending',
        progress: 0,
        stage: 'downloading',
        startedAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
        resultUrl: undefined,
        metadata: undefined,
        error: undefined,
      } as ProcessingStatus);
    });

    /**
     * Test error field mapping
     */
    it('should correctly map error field from database', async () => {
      const mockDbRow: SupabaseStatusRow = {
        upload_id: 'upload-error',
        user_id: 'user-error',
        status: 'error',
        progress: 0,
        stage: 'downloading',
        started_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-01T00:01:00Z',
        error: 'Download failed: Network timeout',
      };

      // Mock successful upsert
      mockSingle.mockResolvedValue({
        data: mockDbRow,
        error: null,
      });

      const result = await statusManager.initStatus('upload-error', 'user-error');

      expect(result.error).toBe('Download failed: Network timeout');
      expect(result.status).toBe('error');
    });
  });

  describe('initStatus() - Basic Functionality', () => {
    /**
     * Test successful initialization
     */
    it('should successfully initialize status with correct default values', async () => {
      const mockDbRow: SupabaseStatusRow = {
        upload_id: 'init-test-123',
        user_id: 'user-init-456',
        status: 'pending',
        progress: 0,
        stage: 'downloading',
        started_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-01T00:00:00Z',
      };

      // Mock successful upsert
      mockSingle.mockResolvedValue({
        data: mockDbRow,
        error: null,
      });

      const result = await statusManager.initStatus('init-test-123', 'user-init-456');

      // Verify default values
      expect(result.uploadId).toBe('init-test-123');
      expect(result.userId).toBe('user-init-456');
      expect(result.status).toBe('pending');
      expect(result.progress).toBe(0);
      expect(result.stage).toBe('downloading');
      expect(result.startedAt).toBeDefined();
      expect(result.updatedAt).toBeDefined();
    });

    /**
     * Test that Supabase client is called with correct parameters
     */
    it('should call Supabase upsert with correct snake_case parameters', async () => {
      const mockDbRow: SupabaseStatusRow = {
        upload_id: 'param-test',
        user_id: 'user-param',
        status: 'pending',
        progress: 0,
        stage: 'downloading',
        started_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-01T00:00:00Z',
      };

      // Mock successful upsert
      mockSingle.mockResolvedValue({
        data: mockDbRow,
        error: null,
      });

      await statusManager.initStatus('param-test', 'user-param');

      // Verify upsert was called with snake_case fields
      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          upload_id: 'param-test',
          user_id: 'user-param',
          status: 'pending',
          progress: 0,
          stage: 'downloading',
          started_at: expect.any(String),
          updated_at: expect.any(String),
        })
      );
    });

    /**
     * Test userId is stored for IDOR protection
     */
    it('should store userId for IDOR protection', async () => {
      const mockDbRow: SupabaseStatusRow = {
        upload_id: 'idor-test',
        user_id: 'secure-user-789',
        status: 'pending',
        progress: 0,
        stage: 'downloading',
        started_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-01T00:00:00Z',
      };

      // Mock successful upsert
      mockSingle.mockResolvedValue({
        data: mockDbRow,
        error: null,
      });

      const result = await statusManager.initStatus('idor-test', 'secure-user-789');

      // Verify userId is present (security requirement)
      expect(result.userId).toBe('secure-user-789');
    });
  });

  describe('Type Safety - ProcessingStatus fields', () => {
    /**
     * Test all ProcessingStatusType values
     */
    it('should accept all valid ProcessingStatusType values', async () => {
      const validStatuses = ['pending', 'downloading', 'processing', 'completed', 'error'];

      for (const status of validStatuses) {
        const mockDbRow: SupabaseStatusRow = {
          upload_id: `status-${status}`,
          user_id: 'user-type-test',
          status: status as any,
          progress: 0,
          stage: 'downloading',
          started_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-01T00:00:00Z',
        };

        mockSingle.mockResolvedValue({
          data: mockDbRow,
          error: null,
        });

        const result = await statusManager.initStatus(`status-${status}`, 'user-type-test');
        expect(result.status).toBe(status);
      }
    });

    /**
     * Test all ProcessingStage values
     */
    it('should accept all valid ProcessingStage values', async () => {
      const validStages = [
        'downloading',
        'compressing',
        'metadata',
        'audio',
        'audio_skipped',
        'vad_whisper',
        'scene_ocr_excel',
        'upload_result',
        'completed',
      ];

      for (const stage of validStages) {
        const mockDbRow: SupabaseStatusRow = {
          upload_id: `stage-${stage}`,
          user_id: 'user-stage-test',
          status: 'processing',
          progress: 50,
          stage: stage as any,
          started_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-01T00:00:00Z',
        };

        mockSingle.mockResolvedValue({
          data: mockDbRow,
          error: null,
        });

        const result = await statusManager.initStatus(`stage-${stage}`, 'user-stage-test');
        expect(result.stage).toBe(stage);
      }
    });

    /**
     * Test metadata field structure
     */
    it('should correctly handle ProcessingMetadata structure', async () => {
      const mockMetadata = {
        duration: 300,
        segmentCount: 25,
        ocrResultCount: 15,
        transcriptionLength: 5000,
        totalScenes: 20,
        scenesWithOCR: 18,
        scenesWithNarration: 22,
        blobUrl: 'https://blob.vercel-storage.com/result.xlsx',
      };

      const mockDbRow: SupabaseStatusRow = {
        upload_id: 'metadata-test',
        user_id: 'user-metadata',
        status: 'completed',
        progress: 100,
        stage: 'completed',
        started_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-01T00:10:00Z',
        result_url: 'https://example.com/result.xlsx',
        metadata: mockMetadata,
      };

      mockSingle.mockResolvedValue({
        data: mockDbRow,
        error: null,
      });

      const result = await statusManager.initStatus('metadata-test', 'user-metadata');

      expect(result.metadata).toEqual(mockMetadata);
      expect(result.metadata?.duration).toBe(300);
      expect(result.metadata?.segmentCount).toBe(25);
      expect(result.metadata?.totalScenes).toBe(20);
    });
  });
});
