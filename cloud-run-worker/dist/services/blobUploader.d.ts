/**
 * Upload result file (Excel) to R2 storage
 *
 * @param filePath - Path to the Excel file
 * @param uploadId - Upload ID for logging and key generation
 * @param userId - User ID for key generation (optional, defaults to 'system')
 * @returns R2 key of the uploaded file
 */
export declare const uploadResultFile: (filePath: string, uploadId: string, userId?: string) => Promise<string>;
//# sourceMappingURL=blobUploader.d.ts.map