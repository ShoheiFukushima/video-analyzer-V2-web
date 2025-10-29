import { useMutation } from '@tanstack/react-query';
import axios, { AxiosError } from 'axios';

export interface UploadResponse {
  uploadId: string;
  blobUrl: string;
}

export interface UploadError {
  error: string;
  message?: string;
}

export function useVideoUpload() {
  return useMutation<UploadResponse, AxiosError<UploadError>, FormData>({
    mutationFn: async (formData: FormData) => {
      const response = await axios.post<UploadResponse>('/api/upload', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        timeout: 60000, // 60 seconds
      });
      return response.data;
    },
    retry: 2,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
  });
}
