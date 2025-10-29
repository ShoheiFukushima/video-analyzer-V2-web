import { useMutation } from '@tanstack/react-query';
import axios, { AxiosError } from 'axios';
import { put } from '@vercel/blob';

export interface UploadResponse {
  uploadId: string;
  blobUrl: string;
}

export interface UploadError {
  error: string;
  message?: string;
}

export interface UploadInput {
  file: File;
  uploadId: string;
}

export function useVideoUpload() {
  return useMutation<UploadResponse, AxiosError<UploadError> | Error, UploadInput>({
    mutationFn: async ({ file, uploadId }: UploadInput) => {
      // Upload directly to Vercel Blob from client
      // This bypasses API size limits (413 errors)
      try {
        const blob = await put(`uploads/${uploadId}/${file.name}`, file, {
          access: 'public',
          multipart: true, // Enable multipart upload for large files
        });

        // Notify backend about successful upload
        const response = await axios.post<UploadResponse>('/api/upload', {
          uploadId,
          blobUrl: blob.url,
        }, {
          timeout: 10000,
        });

        return response.data;
      } catch (error) {
        if (error instanceof Error) {
          throw error;
        }
        throw new Error('Upload failed');
      }
    },
    retry: 2,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
  });
}
