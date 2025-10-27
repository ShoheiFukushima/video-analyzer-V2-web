import express from 'express';
import { config } from 'dotenv';
import { handleProcessing } from './services/processing.js';
import { createClient } from '@supabase/supabase-js';
// Load environment variables
config();
const app = express();
const PORT = process.env.PORT || 3000;
// Middleware
app.use(express.json());
app.use(express.urlencoded({ limit: '50mb', extended: true }));
// Security: Verify WORKER_SECRET
const authMiddleware = (req, res, next) => {
    const authHeader = req.headers.authorization;
    const expectedAuth = `Bearer ${process.env.WORKER_SECRET}`;
    if (authHeader !== expectedAuth) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
};
// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        version: '2.0.0'
    });
});
// Main processing endpoint
app.post('/process', authMiddleware, async (req, res) => {
    try {
        const { uploadId, blobUrl, fileName, plan, dataConsent, } = req.body;
        // Validation
        if (!uploadId || !blobUrl) {
            return res.status(400).json({
                error: 'Missing required fields: uploadId, blobUrl'
            });
        }
        console.log(`[${uploadId}] Starting processing for: ${fileName}`);
        // Call processing service (核心処理)
        const result = await handleProcessing({
            uploadId,
            blobUrl,
            fileName,
            plan,
            dataConsent,
        });
        // Return success with result URL
        return res.status(200).json({
            success: true,
            uploadId,
            resultUrl: result.resultUrl,
            duration: result.processingDuration,
            metadata: result.metadata,
        });
    }
    catch (error) {
        console.error('Processing error:', error);
        const message = error instanceof Error ? error.message : 'Unknown error';
        return res.status(500).json({
            error: 'Processing failed',
            message,
        });
    }
});
// Status check endpoint
app.get('/status/:uploadId', authMiddleware, async (req, res) => {
    try {
        const { uploadId } = req.params;
        // Initialize Supabase if available
        if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
            const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
            const { data, error } = await supabase
                .from('video_analytics')
                .select('*')
                .eq('upload_id', uploadId)
                .single();
            if (error || !data) {
                return res.status(404).json({ error: 'Upload not found' });
            }
            return res.json({
                uploadId,
                status: 'completed',
                data,
            });
        }
        return res.status(200).json({
            uploadId,
            status: 'pending',
            message: 'Status tracking not configured'
        });
    }
    catch (error) {
        console.error('Status check error:', error);
        return res.status(500).json({ error: 'Status check failed' });
    }
});
// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({
        error: 'Internal server error',
        message: err.message,
    });
});
// Start server
app.listen(PORT, () => {
    console.log(`Cloud Run Worker listening on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`Openness: Public (requires WORKER_SECRET)`);
});
export default app;
