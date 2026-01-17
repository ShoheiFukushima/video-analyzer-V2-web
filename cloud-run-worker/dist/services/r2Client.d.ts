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
 * Generate a key for result files (Excel)
 * @param userId - The user's ID
 * @param uploadId - The upload ID
 * @param fileName - The result file name
 */
export declare function generateResultKey(userId: string, uploadId: string, fileName: string): string;
export { r2Client };
//# sourceMappingURL=r2Client.d.ts.map