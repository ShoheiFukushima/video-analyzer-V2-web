import { put } from '@vercel/blob';
import fs from 'fs';
import path from 'path';

const blobToken = process.env.BLOB_READ_WRITE_TOKEN;

export const uploadResultFile = async (
  filePath: string,
  uploadId: string
): Promise<string> => {
  try {
    console.log(`[${uploadId}] Uploading result file to Vercel Blob...`);

    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    if (!blobToken) {
      throw new Error('BLOB_READ_WRITE_TOKEN is not set');
    }

    const fileName = `${uploadId}_analysis.xlsx`;
    const fileContent = fs.readFileSync(filePath);

    // Upload to Vercel Blob using official SDK
    const blob = await put(fileName, fileContent, {
      access: 'public',
      token: blobToken,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    console.log(`[${uploadId}] File uploaded successfully: ${blob.url}`);

    return blob.url;

  } catch (error) {
    console.error(`[${uploadId}] Upload error:`, {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      type: error instanceof Error ? error.constructor.name : typeof error,
    });

    // Production: Throw error (do not use fallback)
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        `Failed to upload result file to Vercel Blob: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }

    // Development only: Fallback to data URL
    console.warn(`[${uploadId}] DEVELOPMENT MODE: Using fallback data URL`);
    const fileName = path.basename(filePath);
    const fileContent = fs.readFileSync(filePath);
    const base64 = fileContent.toString('base64');
    const dataUrl = `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${base64}`;

    return dataUrl;
  }
};

// Alternative: upload to Google Cloud Storage if Vercel Blob isn't available
export const uploadToGCS = async (
  filePath: string,
  uploadId: string
): Promise<string> => {
  try {
    const fileName = `${uploadId}_analysis.xlsx`;
    const bucketName = process.env.GCS_BUCKET || 'video-analyzer-results';

    // Initialize GCS client and upload
    // This would require Google Cloud Storage SDK
    console.log(`Would upload to GCS: gs://${bucketName}/${fileName}`);

    return `gs://${bucketName}/${fileName}`;

  } catch (error) {
    console.error('GCS upload error:', error);
    throw error;
  }
};
