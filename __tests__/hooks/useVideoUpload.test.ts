import { renderHook, waitFor } from '@testing-library/react';
import { useVideoUpload } from '@/app/hooks/useVideoUpload';
import { TestWrapper } from '@/app/test-utils/test-utils';
import axios from 'axios';
import { put } from '@vercel/blob';

jest.mock('axios');
jest.mock('@vercel/blob');

const mockedAxios = axios as jest.Mocked<typeof axios>;
const mockedPut = put as jest.MockedFunction<typeof put>;

describe('useVideoUpload', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should upload video file successfully', async () => {
    const mockUploadId = 'upload_123';
    const mockBlobUrl = 'https://example.com/video.mp4';
    const mockFile = new File(['test'], 'test.mp4', { type: 'video/mp4' });

    const mockResponse = {
      uploadId: mockUploadId,
      blobUrl: mockBlobUrl,
    };

    // Mock Vercel Blob upload
    mockedPut.mockResolvedValueOnce({
      url: mockBlobUrl,
      downloadUrl: mockBlobUrl,
      pathname: `uploads/${mockUploadId}/test.mp4`,
      contentType: 'video/mp4',
      contentDisposition: 'inline; filename="test.mp4"',
    } as any);

    // Mock backend notification
    mockedAxios.post.mockResolvedValueOnce({ data: mockResponse });

    const { result } = renderHook(() => useVideoUpload(), { wrapper: TestWrapper });

    // Call mutate with correct parameters
    result.current.mutate({ file: mockFile, uploadId: mockUploadId });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual(mockResponse);
    expect(mockedPut).toHaveBeenCalledWith(
      `uploads/${mockUploadId}/test.mp4`,
      mockFile,
      { access: 'public', multipart: true }
    );
    expect(mockedAxios.post).toHaveBeenCalledWith(
      '/api/upload',
      { uploadId: mockUploadId, blobUrl: mockBlobUrl },
      { timeout: 10000 }
    );
  });
});
