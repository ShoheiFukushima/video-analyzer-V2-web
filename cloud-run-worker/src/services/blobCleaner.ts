import { del } from '@vercel/blob';

/**
 * Delete a blob from Vercel Blob storage
 * @param blobUrl - Full URL of the blob to delete
 * @returns Promise<void>
 */
export async function deleteBlob(blobUrl: string): Promise<void> {
  try {
    console.log(`[Blob Cleaner] Deleting blob: ${blobUrl}`);
    await del(blobUrl);
    console.log(`[Blob Cleaner] Successfully deleted: ${blobUrl}`);
  } catch (error) {
    console.error(`[Blob Cleaner] Failed to delete ${blobUrl}:`, error);
    // Don't throw - cleanup failures should not break the main process
  }
}

/**
 * Delete multiple blobs from Vercel Blob storage
 * @param blobUrls - Array of blob URLs to delete
 * @returns Promise<void>
 */
export async function deleteBlobs(blobUrls: string[]): Promise<void> {
  console.log(`[Blob Cleaner] Deleting ${blobUrls.length} blobs...`);

  const deletePromises = blobUrls.map(url => deleteBlob(url));
  await Promise.allSettled(deletePromises);

  console.log(`[Blob Cleaner] Cleanup complete`);
}
