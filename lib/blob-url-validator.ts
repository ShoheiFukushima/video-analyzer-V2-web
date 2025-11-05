/**
 * Blob URL Validator
 * Prevents SSRF (Server-Side Request Forgery) attacks by validating Vercel Blob URLs
 */

/**
 * Validates if a URL is a legitimate Vercel Blob Storage URL
 *
 * Security requirements:
 * - Must be HTTPS protocol only
 * - Hostname must exactly match or be a subdomain of allowed Vercel domains
 * - Prevents bypass attempts like: https://evil.com/?vercel-storage=fake
 *
 * @param url - The URL to validate
 * @returns true if valid Vercel Blob URL, false otherwise
 */
export function isValidVercelBlobUrl(url: string): boolean {
  try {
    const parsedUrl = new URL(url);

    // Security: Only allow HTTPS
    if (parsedUrl.protocol !== 'https:') {
      return false;
    }

    // Allowed Vercel Blob Storage domains
    const validHosts = [
      'vercel-storage.com',
      'blob.vercel-storage.com',
    ];

    // Check if hostname exactly matches or is a valid subdomain
    const isValidHost = validHosts.some(validHost => {
      return (
        parsedUrl.hostname === validHost ||
        parsedUrl.hostname.endsWith(`.${validHost}`)
      );
    });

    return isValidHost;
  } catch (error) {
    // Invalid URL format
    return false;
  }
}

/**
 * Validates if a URL is a valid Vercel Blob URL and throws error if invalid
 * Useful for API routes where we want to return specific error messages
 *
 * @param url - The URL to validate
 * @throws Error with descriptive message if invalid
 */
export function assertValidVercelBlobUrl(url: string): void {
  if (!url) {
    throw new Error('Blob URL is required');
  }

  try {
    const parsedUrl = new URL(url);

    if (parsedUrl.protocol !== 'https:') {
      throw new Error('Blob URL must use HTTPS protocol');
    }

    if (!isValidVercelBlobUrl(url)) {
      throw new Error('Invalid Vercel Blob Storage URL. URL must be from vercel-storage.com domain');
    }
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error('Invalid URL format');
    }
    throw error;
  }
}
