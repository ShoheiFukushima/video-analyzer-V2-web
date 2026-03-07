/**
 * Fetch with Retry
 *
 * Wrapper around fetch that automatically retries on auth errors (401, 502).
 * Useful for recovering from session issues after Mac sleep.
 */

interface RetryOptions {
  maxRetries?: number;
  retryDelay?: number;
  onRetry?: (attempt: number, error: Error) => void;
}

const DEFAULT_OPTIONS: Required<RetryOptions> = {
  maxRetries: 3,
  retryDelay: 1000,
  onRetry: () => {},
};

/**
 * Check if the error is retryable
 */
function isRetryableError(status: number): boolean {
  // Retry on auth errors, rate limit, and gateway errors
  return [401, 429, 502, 503, 504].includes(status);
}

/**
 * Parse Retry-After header value into milliseconds
 */
function parseRetryAfter(response: Response): number | null {
  const retryAfter = response.headers.get("retry-after");
  if (!retryAfter) return null;

  const seconds = Number(retryAfter);
  if (!isNaN(seconds)) {
    return seconds * 1000;
  }
  // Try HTTP-date format
  const date = new Date(retryAfter);
  if (!isNaN(date.getTime())) {
    return Math.max(0, date.getTime() - Date.now());
  }
  return null;
}

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch with automatic retry on auth/gateway errors
 *
 * @param url - URL to fetch
 * @param init - Fetch options
 * @param options - Retry options
 * @returns Response
 *
 * @example
 * const response = await fetchWithRetry('/api/process', {
 *   method: 'POST',
 *   body: JSON.stringify(data),
 * });
 */
export async function fetchWithRetry(
  url: string,
  init?: RequestInit,
  options?: RetryOptions
): Promise<Response> {
  const { maxRetries, retryDelay, onRetry } = { ...DEFAULT_OPTIONS, ...options };

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, init);

      if (response.ok) {
        return response;
      }

      // Check if we should retry
      if (isRetryableError(response.status) && attempt < maxRetries) {
        const error = new Error(`HTTP ${response.status}: ${response.statusText}`);
        onRetry(attempt, error);

        // Use Retry-After header if present, otherwise exponential backoff
        const retryAfterMs = parseRetryAfter(response);
        const backoffMs = retryDelay * attempt;
        const waitMs = retryAfterMs !== null ? Math.max(retryAfterMs, backoffMs) : backoffMs;

        console.warn(
          `[fetchWithRetry] Attempt ${attempt}/${maxRetries} failed with ${response.status}, ` +
          `retrying in ${waitMs}ms...` +
          (retryAfterMs !== null ? ` (Retry-After: ${retryAfterMs}ms)` : "")
        );

        await sleep(waitMs);
        continue;
      }

      // Non-retryable error or max retries reached
      return response;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Network errors are retryable
      if (attempt < maxRetries) {
        onRetry(attempt, lastError);

        console.warn(
          `[fetchWithRetry] Attempt ${attempt}/${maxRetries} failed with network error, ` +
          `retrying in ${retryDelay}ms...`
        );

        await sleep(retryDelay * attempt);
        continue;
      }
    }
  }

  // All retries exhausted
  throw lastError || new Error("All retry attempts failed");
}

/**
 * Create a fetch function with retry that includes auth token
 *
 * @param getToken - Function to get the current auth token
 * @returns Fetch function with retry and auth
 */
export function createAuthenticatedFetch(
  getToken: () => Promise<string | null>
): typeof fetchWithRetry {
  return async (url, init, options) => {
    const token = await getToken();

    const headers = new Headers(init?.headers);
    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }

    return fetchWithRetry(
      url,
      {
        ...init,
        headers,
      },
      options
    );
  };
}
