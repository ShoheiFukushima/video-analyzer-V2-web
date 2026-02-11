import { S3Client } from '@aws-sdk/client-s3';
declare const r2Client: S3Client;
export declare const R2_BUCKET: string;
/**
 * Generate a presigned URL for downloading a file from R2
 * @param key - The object key (path) in R2
 * @param expiresIn - URL expiration time in seconds (default: 1 hour)
 */
export declare function getDownloadUrl(key: string, expiresIn?: number): Promise<string>;
/**
 * Upload a file to R2
 * @param key - The object key (path) in R2
 * @param body - The file contents as Buffer
 * @param contentType - The MIME type of the file
 */
export declare function uploadToR2(key: string, body: Buffer, contentType: string): Promise<string>;
/**
 * Delete a file from R2
 * @param key - The object key (path) to delete
 */
export declare function deleteFromR2(key: string): Promise<void>;
/**
 * Download a file from R2 directly using AWS SDK (bypasses presigned URL SSL issues)
 * @param key - The object key (path) in R2
 * @returns ReadableStream of the file content
 */
export declare function downloadFromR2(key: string): Promise<{
    body: ReadableStream | NodeJS.ReadableStream;
    contentLength: number | undefined;
}>;
/**
 * Options for parallel download
 */
export interface ParallelDownloadOptions {
    chunkSize?: number;
    concurrency?: number;
    onProgress?: (downloaded: number, total: number) => void;
    maxRetries?: number;
}
/**
 * Download a file from R2 using parallel chunk downloads for high-speed transfer
 * Uses Range headers to download multiple chunks simultaneously
 *
 * Performance: 5 parallel connections can achieve 5x faster download than single stream
 *
 * @param key - The object key (path) in R2
 * @param destPath - Local file path to save the downloaded file
 * @param options - Download options (chunk size, concurrency, progress callback)
 */
export declare function downloadFromR2Parallel(key: string, destPath: string, options?: ParallelDownloadOptions): Promise<void>;
/**
 * Generate a key for result files (Excel)
 * @param userId - The user's ID
 * @param uploadId - The upload ID
 * @param fileName - The result file name
 */
export declare function generateResultKey(userId: string, uploadId: string, fileName: string): string;
export { r2Client };
//# sourceMappingURL=r2Client.d.ts.map