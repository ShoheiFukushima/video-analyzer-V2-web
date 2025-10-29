import { renderHook } from '@testing-library/react';
import { useErrorHandler } from '@/app/hooks/useErrorHandler';
import { AxiosError } from 'axios';

describe('useErrorHandler', () => {
  it('should handle AxiosError with 500 status', () => {
    const { result } = renderHook(() => useErrorHandler());

    const axiosError = new AxiosError(
      'Server error',
      '500',
      undefined,
      undefined,
      {
        status: 500,
        data: { message: 'Internal server error' },
      } as any
    );

    const errorDetails = result.current.handleError(axiosError);

    expect(errorDetails.status).toBe(500);
    expect(errorDetails.message).toBe('Internal server error');
    expect(errorDetails.retryable).toBe(true);
  });

  it('should handle network error (status 0)', () => {
    const { result } = renderHook(() => useErrorHandler());

    const networkError = new Error('Network error');
    const errorDetails = result.current.handleError(networkError);

    expect(errorDetails.status).toBe(0);
    expect(errorDetails.message).toBe('Network error');
    expect(errorDetails.retryable).toBe(true);
  });

  it('should handle 404 error (not retryable)', () => {
    const { result } = renderHook(() => useErrorHandler());

    const notFoundError = new AxiosError(
      'Not found',
      '404',
      undefined,
      undefined,
      {
        status: 404,
        data: { message: 'Resource not found' },
      } as any
    );

    const errorDetails = result.current.handleError(notFoundError);

    expect(errorDetails.status).toBe(404);
    expect(errorDetails.retryable).toBe(false);
  });

  it('should handle rate limit error (429 - retryable)', () => {
    const { result } = renderHook(() => useErrorHandler());

    const rateLimitError = new AxiosError(
      'Too many requests',
      '429',
      undefined,
      undefined,
      {
        status: 429,
        data: { message: 'Rate limited' },
      } as any
    );

    const errorDetails = result.current.handleError(rateLimitError);

    expect(errorDetails.status).toBe(429);
    expect(errorDetails.retryable).toBe(true);
  });

  it('should handle unknown error', () => {
    const { result } = renderHook(() => useErrorHandler());

    const errorDetails = result.current.handleError(null);

    expect(errorDetails.status).toBe(0);
    expect(errorDetails.message).toBe('An unknown error occurred');
    expect(errorDetails.retryable).toBe(true);
  });
});
