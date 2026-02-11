import { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand, HeadObjectCommand, } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { Agent } from 'https';
import * as fs from 'fs';
import pLimit from 'p-limit';
// Connection pool optimization for high-throughput downloads
const httpsAgent = new Agent({
    keepAlive: true,
    maxSockets: 100, // Allow 100 parallel connections (increased for better throughput)
    keepAliveMsecs: 120000, // Keep connections alive for 2 minutes (reduced TLS handshake overhead)
});
// R2 client initialization with optimized connection handling
// forcePathStyle is required for R2's S3-compatible API
// Note: R2_ENDPOINT can be set directly to avoid SSL issues with template strings
const r2Endpoint = process.env.R2_ENDPOINT || `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
console.log(`[R2Client] Initializing with endpoint: ${r2Endpoint}`);
const r2Client = new S3Client({
    region: 'auto',
    endpoint: r2Endpoint,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
    forcePathStyle: true,
    requestHandler: new NodeHttpHandler({
        httpsAgent,
        connectionTimeout: 30000, // 30 second connection timeout (faster failure on connection issues)
        socketTimeout: 600000, // 10 minute socket timeout per chunk (for slow R2 connections)
    }),
});
export const R2_BUCKET = process.env.R2_BUCKET_NAME;
/**
 * Generate a presigned URL for downloading a file from R2
 * @param key - The object key (path) in R2
 * @param expiresIn - URL expiration time in seconds (default: 1 hour)
 */
export async function getDownloadUrl(key, expiresIn = 3600) {
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
export async function uploadToR2(key, body, contentType) {
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
export async function deleteFromR2(key) {
    const command = new DeleteObjectCommand({
        Bucket: R2_BUCKET,
        Key: key,
    });
    await r2Client.send(command);
}
/**
 * Download a file from R2 directly using AWS SDK (bypasses presigned URL SSL issues)
 * @param key - The object key (path) in R2
 * @returns ReadableStream of the file content
 */
export async function downloadFromR2(key) {
    console.log(`[R2Client] Downloading file directly: ${key}`);
    console.log(`[R2Client] Bucket: ${R2_BUCKET}`);
    const command = new GetObjectCommand({
        Bucket: R2_BUCKET,
        Key: key,
    });
    console.log(`[R2Client] Sending GetObjectCommand...`);
    const sendStartTime = Date.now();
    try {
        const response = await r2Client.send(command);
        console.log(`[R2Client] GetObjectCommand completed in ${Date.now() - sendStartTime}ms`);
        console.log(`[R2Client] Response ContentLength: ${response.ContentLength}`);
        if (!response.Body) {
            throw new Error('R2 returned empty body');
        }
        return {
            body: response.Body,
            contentLength: response.ContentLength,
        };
    }
    catch (error) {
        console.error(`[R2Client] GetObjectCommand failed after ${Date.now() - sendStartTime}ms:`, error);
        throw error;
    }
}
/**
 * Size thresholds for download strategy
 */
const SIZE_THRESHOLDS = {
    SMALL: 100 * 1024 * 1024, // < 100MB: single stream
    MEDIUM: 500 * 1024 * 1024, // 100MB - 500MB: light parallel
    LARGE: 1024 * 1024 * 1024, // 500MB - 1GB: standard parallel
    HUGE: 2 * 1024 * 1024 * 1024, // > 1GB: heavy parallel (2GB support)
};
/**
 * Get optimal download settings based on file size
 * Note: Always use Range-based downloads (even for small files) to avoid stream hanging issues
 */
function getDownloadSettings(fileSize) {
    if (fileSize < SIZE_THRESHOLDS.SMALL) {
        // Small files: use Range header but with single chunk for simplicity
        // This avoids the stream hanging issue with non-Range GetObject
        return { chunkSize: fileSize, concurrency: 1, description: 'range-single (<100MB)' };
    }
    else if (fileSize < SIZE_THRESHOLDS.MEDIUM) {
        return { chunkSize: 25 * 1024 * 1024, concurrency: 4, description: 'light-parallel (100-500MB)' };
    }
    else if (fileSize < SIZE_THRESHOLDS.LARGE) {
        return { chunkSize: 50 * 1024 * 1024, concurrency: 3, description: 'standard-parallel (500MB-1GB)' };
    }
    else {
        // 1GB+ files: larger chunks, lower concurrency for stability
        return { chunkSize: 64 * 1024 * 1024, concurrency: 2, description: 'heavy-parallel (1GB+)' };
    }
}
/**
 * Get file size from R2 using HeadObject
 */
async function getFileSize(key) {
    const command = new HeadObjectCommand({
        Bucket: R2_BUCKET,
        Key: key,
    });
    const response = await r2Client.send(command);
    if (!response.ContentLength) {
        throw new Error('Unable to determine file size');
    }
    return response.ContentLength;
}
/**
 * Download a single chunk using Range header
 * Includes timeout handling to prevent hanging streams
 */
async function downloadChunk(key, start, end, retries = 5 // Increased from 3 to 5 for better resilience
) {
    const chunkSize = end - start + 1;
    const CHUNK_TIMEOUT = 300000; // 5 minutes per chunk (for slow R2 at ~100KB/s)
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const commandStartTime = Date.now();
            const command = new GetObjectCommand({
                Bucket: R2_BUCKET,
                Key: key,
                Range: `bytes=${start}-${end}`,
            });
            console.log(`[R2Client] Chunk ${start}-${end} (${(chunkSize / 1024 / 1024).toFixed(1)}MB): sending request...`);
            const response = await r2Client.send(command);
            console.log(`[R2Client] Chunk ${start}-${end}: got response in ${Date.now() - commandStartTime}ms`);
            if (!response.Body) {
                throw new Error('R2 returned empty body for chunk');
            }
            // Convert stream to buffer with timeout
            const dataChunks = [];
            const stream = response.Body;
            let receivedBytes = 0;
            let lastDataTime = Date.now();
            return new Promise((resolve, reject) => {
                // Timeout for the entire chunk download
                const timeout = setTimeout(() => {
                    const error = new Error(`Chunk download timeout after ${CHUNK_TIMEOUT / 1000}s (received ${receivedBytes}/${chunkSize} bytes)`);
                    console.error(`[R2Client] ${error.message}`);
                    if ('destroy' in stream && typeof stream.destroy === 'function') {
                        stream.destroy(error);
                    }
                    reject(error);
                }, CHUNK_TIMEOUT);
                // Stall detection - no data for 45 seconds (increased for slow R2)
                const stallCheck = setInterval(() => {
                    if (Date.now() - lastDataTime > 45000) {
                        clearInterval(stallCheck);
                        clearTimeout(timeout);
                        const error = new Error(`Chunk stream stalled - no data for 45s (received ${receivedBytes}/${chunkSize} bytes)`);
                        console.error(`[R2Client] ${error.message}`);
                        if ('destroy' in stream && typeof stream.destroy === 'function') {
                            stream.destroy(error);
                        }
                        reject(error);
                    }
                }, 5000);
                stream.on('data', (chunk) => {
                    dataChunks.push(chunk);
                    receivedBytes += chunk.length;
                    lastDataTime = Date.now();
                });
                stream.on('end', () => {
                    clearTimeout(timeout);
                    clearInterval(stallCheck);
                    const duration = Date.now() - commandStartTime;
                    // Fix: duration is in ms, need to convert to seconds for speed calculation
                    const speedMBps = (chunkSize / 1024 / 1024) / (duration / 1000);
                    console.log(`[R2Client] Chunk ${start}-${end}: completed in ${duration}ms (${speedMBps.toFixed(2)} MB/s)`);
                    resolve(Buffer.concat(dataChunks));
                });
                stream.on('error', (err) => {
                    clearTimeout(timeout);
                    clearInterval(stallCheck);
                    reject(err);
                });
            });
        }
        catch (error) {
            const isConnectionError = error?.code === 'ECONNRESET' ||
                error?.code === 'ETIMEDOUT' ||
                error?.code === 'ECONNABORTED' ||
                error?.message?.includes('aborted');
            if (attempt === retries) {
                console.error(`[R2Client] Chunk ${start}-${end} failed after ${retries} attempts: ${error?.message || error}`);
                throw error;
            }
            // Longer backoff for connection errors (2s, 4s, 8s, 16s base)
            // Shorter backoff for other errors (1s, 2s, 3s, 4s base)
            const baseDelay = isConnectionError ? 2000 : 1000;
            const delay = baseDelay * Math.pow(2, attempt - 1); // Exponential backoff
            const maxDelay = 30000; // Cap at 30 seconds
            const actualDelay = Math.min(delay, maxDelay);
            console.warn(`[R2Client] Chunk ${start}-${end} failed (attempt ${attempt}/${retries}, ${isConnectionError ? 'connection error' : 'other error'}), retrying in ${actualDelay / 1000}s...`);
            await new Promise(resolve => setTimeout(resolve, actualDelay));
        }
    }
    throw new Error('All retry attempts failed');
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
export async function downloadFromR2Parallel(key, destPath, options = {}) {
    const { onProgress, maxRetries = 5 } = options; // Increased from 3 to 5
    console.log(`[R2Client] Starting parallel download: ${key}`);
    const startTime = Date.now();
    // Get file size first to determine optimal settings
    const fileSize = await getFileSize(key);
    const fileSizeMB = (fileSize / 1024 / 1024).toFixed(2);
    console.log(`[R2Client] File size: ${fileSizeMB} MB`);
    // Auto-adjust settings based on file size (unless overridden)
    const autoSettings = getDownloadSettings(fileSize);
    const chunkSize = options.chunkSize ?? autoSettings.chunkSize;
    const concurrency = options.concurrency ?? autoSettings.concurrency;
    console.log(`[R2Client] Strategy: ${autoSettings.description}`);
    console.log(`[R2Client] Settings: chunkSize=${(chunkSize / 1024 / 1024).toFixed(0)}MB, concurrency=${concurrency}`);
    // Always use Range-based download (even for small files) to avoid stream hanging issues
    // Note: Non-Range GetObject can hang indefinitely on some networks
    // Calculate chunks
    const chunks = [];
    let position = 0;
    let index = 0;
    while (position < fileSize) {
        const end = Math.min(position + chunkSize - 1, fileSize - 1);
        chunks.push({ start: position, end, index });
        position = end + 1;
        index++;
    }
    console.log(`[R2Client] Downloading ${chunks.length} chunks with ${concurrency} parallel connections`);
    // Create file and pre-allocate space
    const fd = fs.openSync(destPath, 'w');
    fs.ftruncateSync(fd, fileSize);
    // Track progress
    let totalDownloaded = 0;
    const chunkProgress = new Map();
    // Use p-limit for concurrency control
    const limit = pLimit(concurrency);
    // Download all chunks in parallel
    const downloadPromises = chunks.map(chunk => limit(async () => {
        const chunkData = await downloadChunk(key, chunk.start, chunk.end, maxRetries);
        // Write chunk to correct position in file
        fs.writeSync(fd, chunkData, 0, chunkData.length, chunk.start);
        // Sync to disk immediately - critical for tmpfs on Cloud Run
        // Without fsync, ffprobe may read incomplete data causing hangs
        fs.fsyncSync(fd);
        // Update progress
        chunkProgress.set(chunk.index, chunkData.length);
        totalDownloaded = Array.from(chunkProgress.values()).reduce((a, b) => a + b, 0);
        const percent = ((totalDownloaded / fileSize) * 100).toFixed(1);
        const elapsed = (Date.now() - startTime) / 1000;
        const speed = (totalDownloaded / 1024 / 1024) / elapsed;
        console.log(`[R2Client] Progress: ${percent}% (${(totalDownloaded / 1024 / 1024).toFixed(1)}/${(fileSize / 1024 / 1024).toFixed(1)} MB) @ ${speed.toFixed(2)} MB/s`);
        onProgress?.(totalDownloaded, fileSize);
        return chunk.index;
    }));
    try {
        await Promise.all(downloadPromises);
    }
    finally {
        fs.closeSync(fd);
    }
    // Verify file integrity after download
    const finalStats = fs.statSync(destPath);
    if (finalStats.size !== fileSize) {
        throw new Error(`[R2Client] File size mismatch: expected ${fileSize} bytes, got ${finalStats.size} bytes`);
    }
    console.log(`[R2Client] File integrity verified: ${finalStats.size} bytes`);
    const totalDuration = (Date.now() - startTime) / 1000;
    const averageSpeed = (fileSize / 1024 / 1024) / totalDuration;
    console.log(`[R2Client] Parallel download complete!`);
    console.log(`[R2Client] Total time: ${totalDuration.toFixed(1)}s`);
    console.log(`[R2Client] Average speed: ${averageSpeed.toFixed(2)} MB/s`);
    console.log(`[R2Client] File saved to: ${destPath}`);
}
/**
 * Generate a key for result files (Excel)
 * @param userId - The user's ID
 * @param uploadId - The upload ID
 * @param fileName - The result file name
 */
export function generateResultKey(userId, uploadId, fileName) {
    return `results/${userId}/${uploadId}/${fileName}`;
}
export { r2Client };
//# sourceMappingURL=r2Client.js.map