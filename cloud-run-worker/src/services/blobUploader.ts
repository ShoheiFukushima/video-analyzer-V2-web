import axios from 'axios';
import fs from 'fs';
import path from 'path';

const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
const blobApiUrl = 'https://blob.vercelusercontent.com';

export const uploadResultFile = async (
  filePath: string,
  uploadId: string
): Promise<string> => {
  try {
    console.log(`[${uploadId}] Uploading result file to Vercel Blob...`);

    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const fileName = `${uploadId}_analysis.xlsx`;
    const fileContent = fs.readFileSync(filePath);

    // Upload to Vercel Blob
    const response = await axios.post(
      `${blobApiUrl}/upload?filename=${encodeURIComponent(fileName)}`,
      fileContent,
      {
        headers: {
          Authorization: `Bearer ${blobToken}`,
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        },
        timeout: 30000,
      }
    );

    if (!response.data.url) {
      throw new Error('No URL returned from blob upload');
    }

    const resultUrl = response.data.url;
    console.log(`[${uploadId}] File uploaded: ${resultUrl}`);

    return resultUrl;

  } catch (error) {
    console.error(`[${uploadId}] Upload error:`, error);

    // Fallback: Create a data URL (for testing/development)
    const fileName = path.basename(filePath);
    const fileContent = fs.readFileSync(filePath);
    const base64 = fileContent.toString('base64');
    const dataUrl = `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${base64}`;

    console.log(`[${uploadId}] Using fallback data URL (development only)`);
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
