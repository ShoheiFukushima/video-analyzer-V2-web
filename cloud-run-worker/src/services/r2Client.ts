import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
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
 * Generate a presigned URL for downloading a file from R2
 * @param key - The object key (path) in R2
 * @param expiresIn - URL expiration time in seconds (default: 1 hour)
 */
export async function getDownloadUrl(key: string, expiresIn: number = 3600): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
  });
  return getSignedUrl(r2Client, command, { expiresIn });
}

/**
 * Upload a file to R2
 * @param key - The object key (path) in R2
 * @param body - The file contents as Buffer
 * @param contentType - The MIME type of the file
 */
export async function uploadToR2(
  key: string,
  body: Buffer,
  contentType: string
): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    Body: body,
    ContentType: contentType,
  });
  await r2Client.send(command);
  return key;
}

/**
 * Delete a file from R2
 * @param key - The object key (path) to delete
 */
export async function deleteFromR2(key: string): Promise<void> {
  const command = new DeleteObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
  });
  await r2Client.send(command);
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
