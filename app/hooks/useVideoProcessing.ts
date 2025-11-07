import { useMutation, useQuery } from '@tanstack/react-query';
import axios, { AxiosError } from 'axios';
import type {
  ProcessVideoRequest,
  ProcessVideoResponse,
  StatusResponse,
} from '@/types/shared';

// Re-export shared types for backward compatibility
export type ProcessRequest = ProcessVideoRequest;
export type ProcessResponse = ProcessVideoResponse;
export type ProcessingStatus = StatusResponse;

export interface ProcessError {
  error: string;
  message?: string;
}

export function useVideoProcess() {
  return useMutation<ProcessResponse, AxiosError<ProcessError>, ProcessRequest>({
    mutationFn: async (request: ProcessRequest) => {
      const response = await axios.post<ProcessResponse>('/api/process', request, {
        timeout: 30000, // 30 seconds for API call
      });
      return response.data;
    },
    retry: 2,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10000),
  });
}

export function useProcessingStatus(uploadId: string | null, enabled = true) {
  return useQuery<ProcessingStatus, AxiosError<ProcessError>>({
    queryKey: ['processingStatus', uploadId],
    queryFn: async () => {
      if (!uploadId) throw new Error('No upload ID provided');
      const response = await axios.get<ProcessingStatus>(`/api/status/${uploadId}`, {
        timeout: 10000,
      });
      return response.data;
    },
    enabled: !!uploadId && enabled,
    refetchInterval: 10000, // Poll every 10 seconds (reduced from 5s to minimize Supabase load)
    refetchIntervalInBackground: false,
    retry: 3,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 5000),
  });
}
