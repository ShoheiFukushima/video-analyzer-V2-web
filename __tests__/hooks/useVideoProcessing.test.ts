import { renderHook, waitFor } from '@testing-library/react';
import { useVideoProcess, useProcessingStatus } from '@/app/hooks/useVideoProcessing';
import { TestWrapper } from '@/app/test-utils/test-utils';
import axios from 'axios';

jest.mock('axios');

const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('useVideoProcess', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should start processing successfully', async () => {
    const mockResponse = {
      success: true,
      uploadId: 'upload_123',
      message: 'Processing started successfully',
    };

    mockedAxios.post.mockResolvedValueOnce({ data: mockResponse });

    const { result } = renderHook(() => useVideoProcess(), { wrapper: TestWrapper });

    result.current.mutate({
      uploadId: 'upload_123',
      blobUrl: 'https://example.com/video.mp4',
      fileName: 'test.mp4',
      dataConsent: true,
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual(mockResponse);
  });
});

describe('useProcessingStatus', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should fetch processing status', async () => {
    const mockStatus = {
      uploadId: 'upload_123',
      status: 'completed' as const,
      resultUrl: 'https://example.com/result.xlsx',
      metadata: {
        duration: 120,
        segmentCount: 10,
        ocrResultCount: 50,
      },
    };

    mockedAxios.get.mockResolvedValueOnce({ data: mockStatus });

    const { result } = renderHook(() => useProcessingStatus('upload_123'), { wrapper: TestWrapper });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual(mockStatus);
  });

  it('should not fetch when uploadId is null', () => {
    const { result } = renderHook(() => useProcessingStatus(null), { wrapper: TestWrapper });

    // When enabled is false, the query should not be fetching
    expect(result.current.isFetching).toBe(false);
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });
});
