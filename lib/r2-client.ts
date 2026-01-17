import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// R2 client initialization
const r2Client = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

export const R2_BUCKET = process.env.R2_BUCKET_NAME!;

/**
 * Generate a presigned URL for uploading a file to R2
 * @param key - The object key (path) in R2
 * @param contentType - The MIME type of the file
 * @param expiresIn - URL expiration time in seconds (default: 15 minutes)
 */
export async function generateUploadUrl(
  key: string,
  contentType: string,
  expiresIn: number = 900
): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    ContentType: contentType,
  });
  return getSignedUrl(r2Client, command, { expiresIn });
}

/**
 * Generate a presigned URL for downloading a file from R2
 * @param key - The object key (path) in R2
 * @param expiresIn - URL expiration time in seconds (default: 1 hour)
 * @param downloadFilename - Optional filename for Content-Disposition header
 */
export async function generateDownloadUrl(
  key: string,
  expiresIn: number = 3600,
  downloadFilename?: string
): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    ...(downloadFilename && {
      ResponseContentDisposition: `attachment; filename="${encodeURIComponent(downloadFilename)}"`,
    }),
  });
  return getSignedUrl(r2Client, command, { expiresIn });
}

/**
 * Delete an object from R2
 * @param key - The object key (path) to delete
 */
export async function deleteObject(key: string): Promise<void> {
  const command = new DeleteObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
  });
  await r2Client.send(command);
}

/**
 * Check if an object exists in R2
 * @param key - The object key (path) to check
 */
export async function objectExists(key: string): Promise<boolean> {
  try {
    const command = new HeadObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
    });
    await r2Client.send(command);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate R2 key format for security
 * Expected format: uploads/{userId}/{uploadId}/{fileName} or results/{userId}/{uploadId}/{fileName}
 */
export function isValidR2Key(key: string): boolean {
  const pattern = /^(uploads|results)\/[a-zA-Z0-9_-]+\/upload_\d+_[a-zA-Z0-9]+\/.+$/;
  return pattern.test(key);
}

/**
 * Check if a URL is an R2 URL
 */
export function isR2Url(url: string): boolean {
  return url.includes('.r2.cloudflarestorage.com') || url.includes('.r2.dev');
}

/**
 * Generate a key for video uploads
 * @param userId - The user's ID
 * @param uploadId - The upload ID
 * @param fileName - The original file name
 */
export function generateVideoKey(userId: string, uploadId: string, fileName: string): string {
  return `uploads/${userId}/${uploadId}/${fileName}`;
}

/**
 * Generate a key for result files (Excel)
 * @param userId - The user's ID
 * @param uploadId - The upload ID
 * @param fileName - The result file name
 */
export function generateResultKey(userId: string, uploadId: string, fileName: string): string {
  return `results/${userId}/${uploadId}/${fileName}`;
}

export { r2Client };
