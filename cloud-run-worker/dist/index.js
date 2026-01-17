import express from 'express';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { processVideo } from './services/videoProcessor.js';
import { getStatus } from './services/statusManager.js';
dotenv.config();
const app = express();
const port = process.env.PORT || 8080;
const workerSecret = process.env.WORKER_SECRET;
// In-memory storage for result file paths (development only)
export const resultFileMap = new Map();
// Middleware
app.use(express.json({ limit: '10mb' }));
// Authentication middleware
const validateAuth = (req, res, next) => {
    const authHeader = req.headers.authorization;
    const token = authHeader?.replace('Bearer ', '');
    if (!token || token !== workerSecret) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }
    next();
};
// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});
// Process video endpoint
app.post('/process', validateAuth, async (req, res) => {
    try {
        const { uploadId, r2Key, fileName, userId, dataConsent, detectionMode } = req.body;
        // Security: Validate required fields including userId for IDOR protection
        if (!uploadId || !r2Key || !userId) {
            res.status(400).json({
                error: 'Invalid request',
                message: 'Missing uploadId, r2Key, or userId'
            });
            return;
        }
        // Validate detectionMode (default to 'standard' if not provided or invalid)
        const validModes = ['standard', 'enhanced'];
        const mode = validModes.includes(detectionMode) ? detectionMode : 'standard';
        console.log(`[${uploadId}] Starting video processing`, {
            fileName,
            userId,
            r2Key,
            detectionMode: mode
        });
        // Start processing asynchronously with userId for access control
        processVideo(uploadId, r2Key, fileName, userId, dataConsent, mode)
            .catch(err => {
            console.error(`[${uploadId}] Processing error:`, err);
        });
        // Return immediately - processing happens in background
        res.json({
            success: true,
            uploadId,
            message: 'Video processing started',
            status: 'processing',
            detectionMode: mode
        });
    }
    catch (error) {
        console.error('[Process endpoint] Error:', error);
        res.status(500).json({
            error: 'Server error',
            message: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});
// Get status endpoint
app.get('/status/:uploadId', validateAuth, async (req, res) => {
    try {
        const { uploadId } = req.params;
        const status = await getStatus(uploadId);
        if (!status) {
            res.status(404).json({ error: 'Upload not found' });
            return;
        }
        res.json(status);
    }
    catch (error) {
        console.error('[Status endpoint] Error:', error);
        res.status(500).json({
            error: 'Server error',
            message: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});
// Download result endpoint (development mode)
app.get('/result/:uploadId', validateAuth, async (req, res) => {
    try {
        const { uploadId } = req.params;
        console.log(`[${uploadId}] Result download requested`);
        // Try to get file path from memory map first
        let filePath = resultFileMap.get(uploadId);
        // If not in memory map (e.g., after worker restart), fallback to filesystem
        if (!filePath) {
            console.log(`[${uploadId}] Not found in memory map, checking filesystem...`);
            const expectedPath = path.join('/tmp', `result_${uploadId}.xlsx`);
            if (fs.existsSync(expectedPath)) {
                filePath = expectedPath;
                console.log(`[${uploadId}] Found file on disk: ${filePath}`);
            }
            else {
                console.error(`[${uploadId}] Result file not found in memory map or disk`);
                res.status(404).json({ error: 'Result not found' });
                return;
            }
        }
        // Check if file exists
        if (!fs.existsSync(filePath)) {
            console.error(`[${uploadId}] Result file not found on disk: ${filePath}`);
            res.status(404).json({ error: 'Result file not found' });
            return;
        }
        console.log(`[${uploadId}] Sending result file: ${path.basename(filePath)}`);
        // Set headers for file download
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${path.basename(filePath)}"`);
        // Stream file to response
        const fileStream = fs.createReadStream(filePath);
        fileStream.pipe(res);
        fileStream.on('error', (error) => {
            console.error(`[${uploadId}] File stream error:`, error);
            if (!res.headersSent) {
                res.status(500).json({ error: 'Failed to stream file' });
            }
        });
    }
    catch (error) {
        console.error('[Result endpoint] Error:', error);
        if (!res.headersSent) {
            res.status(500).json({
                error: 'Server error',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }
});
// Environment validation
const requiredEnvVars = [
    'WORKER_SECRET',
    'GEMINI_API_KEY',
    'OPENAI_API_KEY',
    'R2_ACCOUNT_ID',
    'R2_ACCESS_KEY_ID',
    'R2_SECRET_ACCESS_KEY',
    'R2_BUCKET_NAME',
];
const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);
if (missingEnvVars.length > 0) {
    console.warn('[Cloud Run Worker] Missing environment variables:', missingEnvVars.join(', '));
    console.warn('[Cloud Run Worker] Some features may not work properly');
}
// Error handling
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? err.message : 'An error occurred'
    });
});
app.listen(port, () => {
    console.log(`[Cloud Run Worker] Server running on port ${port}`);
    console.log(`[Cloud Run Worker] NODE_ENV: ${process.env.NODE_ENV}`);
});
//# sourceMappingURL=index.js.map