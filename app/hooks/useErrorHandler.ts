import { AxiosError } from 'axios';

export interface ErrorDetails {
  status: number;
  message: string;
  code: string;
  retryable: boolean;
}

export function useErrorHandler() {
  const handleError = (error: unknown): ErrorDetails => {
    if (error instanceof AxiosError) {
      const status = error.response?.status || 0;
      const message = error.response?.data?.message || error.message || 'Unknown error';

      // Determine if error is retryable
      const retryable = status === 0 || status >= 500 || status === 408 || status === 429;

      return {
        status,
        message,
        code: error.code || 'UNKNOWN_ERROR',
        retryable,
      };
    }

    if (error instanceof Error) {
      return {
        status: 0,
        message: error.message,
        code: 'ERROR',
        retryable: true,
      };
    }

    return {
      status: 0,
      message: 'An unknown error occurred',
      code: 'UNKNOWN_ERROR',
      retryable: true,
    };
  };

  return { handleError };
}
