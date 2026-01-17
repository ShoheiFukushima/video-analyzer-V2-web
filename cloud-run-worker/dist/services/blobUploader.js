import fs from 'fs';
import { uploadToR2, generateResultKey } from './r2Client.js';
/**
 * Upload result file (Excel) to R2 storage
 *
 * @param filePath - Path to the Excel file
 * @param uploadId - Upload ID for logging and key generation
 * @param userId - User ID for key generation (optional, defaults to 'system')
 * @returns R2 key of the uploaded file
 */
export const uploadResultFile = async (filePath, uploadId, userId = 'system') => {
    try {
        console.log(`[${uploadId}] Uploading result file to R2...`);
        if (!fs.existsSync(filePath)) {
            throw new Error(`File not found: ${filePath}`);
        }
        // Validate R2 environment variables
        if (!process.env.R2_ACCOUNT_ID || !process.env.R2_ACCESS_KEY_ID ||
            !process.env.R2_SECRET_ACCESS_KEY || !process.env.R2_BUCKET_NAME) {
            throw new Error('R2 environment variables are not properly configured');
        }
        const fileName = `${uploadId}_analysis.xlsx`;
        const r2Key = generateResultKey(userId, uploadId, fileName);
        const fileContent = fs.readFileSync(filePath);
        const contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
        // Upload to R2
        await uploadToR2(r2Key, fileContent, contentType);
        console.log(`[${uploadId}] File uploaded successfully to R2: ${r2Key}`);
        return r2Key;
    }
    catch (error) {
        console.error(`[${uploadId}] R2 upload error:`, {
            message: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            type: error instanceof Error ? error.constructor.name : typeof error,
        });
        // Production: Throw error (do not use fallback)
        if (process.env.NODE_ENV === 'production') {
            throw new Error(`Failed to upload result file to R2: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
        // Development only: Return a placeholder key (file still saved locally)
        console.warn(`[${uploadId}] DEVELOPMENT MODE: R2 upload failed, returning placeholder`);
        return `results/${userId}/${uploadId}/${uploadId}_analysis.xlsx`;
    }
};
//# sourceMappingURL=blobUploader.js.map