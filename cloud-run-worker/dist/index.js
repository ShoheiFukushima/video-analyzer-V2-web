import express from 'express';
import dotenv from 'dotenv';
import { processVideo } from './services/videoProcessor.js';
import { getStatus } from './services/statusManager.js';
dotenv.config();
const app = express();
const port = process.env.PORT || 8080;
const workerSecret = process.env.WORKER_SECRET;
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
        const { uploadId, blobUrl, fileName, dataConsent } = req.body;
        if (!uploadId || !blobUrl) {
            res.status(400).json({
                error: 'Invalid request',
                message: 'Missing uploadId or blobUrl'
            });
            return;
        }
        console.log(`[${uploadId}] Starting video processing`, { fileName });
        // Start processing asynchronously
        processVideo(uploadId, blobUrl, fileName, dataConsent)
            .catch(err => {
            console.error(`[${uploadId}] Processing error:`, err);
        });
        // Return immediately - processing happens in background
        res.json({
            success: true,
            uploadId,
            message: 'Video processing started',
            status: 'processing'
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
// Environment validation
const requiredEnvVars = ['WORKER_SECRET', 'GEMINI_API_KEY', 'OPENAI_API_KEY'];
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