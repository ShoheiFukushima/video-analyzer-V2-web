import { useEffect, useState, useCallback } from 'react';

export interface ProcessingStatusUpdate {
  uploadId: string;
  status: 'uploading' | 'processing' | 'completed' | 'error';
  progress: number;
  message: string;
  resultUrl?: string;
  metadata?: {
    duration: number;
    segmentCount: number;
    ocrResultCount: number;
  };
}

export function useProcessingStatusSSE(uploadId: string | null) {
  const [status, setStatus] = useState<ProcessingStatusUpdate | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    if (!uploadId) {
      return;
    }

    let eventSource: EventSource | null = null;
    const connectSSE = () => {
      try {
        eventSource = new EventSource(`/api/status/stream/${uploadId}`);

        eventSource.addEventListener('progress', (event) => {
          try {
            const data = JSON.parse(event.data) as ProcessingStatusUpdate;
            setStatus(data);
            setError(null);
            setIsConnected(true);
          } catch (err) {
            console.error('Failed to parse SSE message:', err);
          }
        });

        eventSource.addEventListener('error', (event) => {
          console.error('SSE error:', event);
          setError('Connection lost. Please refresh the page.');
          setIsConnected(false);

          // Close the connection to prevent infinite reconnection attempts
          if (eventSource) {
            eventSource.close();
          }
        });

        eventSource.onerror = () => {
          setIsConnected(false);
          if (eventSource) {
            eventSource.close();
          }
        };
      } catch (err) {
        console.error('Failed to connect SSE:', err);
        setError('Failed to connect to server');
        setIsConnected(false);
      }
    };

    connectSSE();

    return () => {
      if (eventSource) {
        eventSource.close();
      }
    };
  }, [uploadId]);

  return { status, error, isConnected };
}
