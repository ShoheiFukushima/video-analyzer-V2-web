# Cloud Run Worker Deployment Guide

## Overview

This is the backend worker service that processes uploaded videos. It handles:
- Video download from Vercel Blob storage
- Audio extraction and transcription (OpenAI Whisper)
- Frame extraction and OCR (Google Gemini Vision)
- Excel report generation
- Result file upload back to Vercel Blob

## Prerequisites

1. **Google Cloud Project** with Cloud Run enabled
2. **API Keys**:
   - OpenAI API key (for Whisper)
   - Google Gemini API key (for Vision OCR)
3. **Supabase Project** for status persistence
4. **Vercel Blob** read/write token

## Setup Steps

### 1. Set Up Environment Variables

Create a `.env` file based on `.env.example`:

```bash
cp .env.example .env
```

Fill in all required values:
```env
PORT=8080
NODE_ENV=production
WORKER_SECRET=your-unique-secret-key

OPENAI_API_KEY=sk-...
GEMINI_API_KEY=your-gemini-key

SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key

BLOB_READ_WRITE_TOKEN=vercel_blob_rw_...
```

### 2. Build Docker Image

```bash
# Build image
docker build -t video-analyzer-worker:latest .

# Test locally
docker run \
  -p 8080:8080 \
  -e PORT=8080 \
  -e WORKER_SECRET=test-secret \
  -e OPENAI_API_KEY=... \
  -e GEMINI_API_KEY=... \
  -e SUPABASE_URL=... \
  -e SUPABASE_ANON_KEY=... \
  -e BLOB_READ_WRITE_TOKEN=... \
  video-analyzer-worker:latest
```

### 3. Deploy to Google Cloud Run

#### Option A: Using gcloud CLI

```bash
# Authenticate with Google Cloud
gcloud auth login
gcloud config set project YOUR-PROJECT-ID

# Deploy from Docker image
gcloud run deploy video-analyzer-worker \
  --source . \
  --platform managed \
  --region us-central1 \
  --memory 2Gi \
  --timeout 3600 \
  --allow-unauthenticated \
  --set-env-vars=WORKER_SECRET=your-secret,OPENAI_API_KEY=...,GEMINI_API_KEY=...,SUPABASE_URL=...,SUPABASE_ANON_KEY=...,BLOB_READ_WRITE_TOKEN=...
```

#### Option B: Using Google Cloud Console

1. Go to [Cloud Run](https://console.cloud.google.com/run)
2. Click "Create Service"
3. Configure:
   - **Name**: `video-analyzer-worker`
   - **Region**: `us-central1`
   - **Memory**: `2GB`
   - **Timeout**: `3600 seconds` (1 hour)
4. Set environment variables in the "Runtime settings" section
5. Deploy

### 4. Configure Frontend Integration

In your Next.js app, set:

```env
CLOUD_RUN_URL=https://video-analyzer-worker-xxx.a.run.app
WORKER_SECRET=your-unique-secret-key
```

### 5. Test the Worker

```bash
# Health check
curl https://video-analyzer-worker-xxx.a.run.app/health

# Trigger processing (replace xxx with actual URL)
curl -X POST https://video-analyzer-worker-xxx.a.run.app/process \
  -H "Authorization: Bearer your-secret" \
  -H "Content-Type: application/json" \
  -d '{
    "uploadId": "test_1234567890",
    "blobUrl": "https://blob.vercelusercontent.com/...",
    "fileName": "test-video.mp4",
    "dataConsent": true
  }'

# Check status
curl https://video-analyzer-worker-xxx.a.run.app/status/test_1234567890 \
  -H "Authorization: Bearer your-secret"
```

## API Endpoints

### Health Check
```
GET /health
```
Returns: `{ "status": "ok", "timestamp": "..." }`

### Trigger Processing
```
POST /process
Authorization: Bearer WORKER_SECRET
Content-Type: application/json

{
  "uploadId": "unique-upload-id",
  "blobUrl": "https://blob.vercelusercontent.com/...",
  "fileName": "video-file.mp4",
  "dataConsent": true
}
```

Returns: `{ "success": true, "uploadId": "...", "status": "processing" }`

### Check Status
```
GET /status/:uploadId
Authorization: Bearer WORKER_SECRET
```

Returns:
```json
{
  "uploadId": "...",
  "status": "processing" | "completed" | "failed",
  "progress": 0-100,
  "stage": "downloading" | "metadata" | "vad" | "frames" | "whisper" | "ocr" | "excel" | "completed",
  "resultUrl": "https://blob.vercelusercontent.com/...",
  "metadata": {
    "duration": 120.5,
    "segmentCount": 8,
    "ocrResultCount": 12,
    "transcriptionLength": 2543
  }
}
```

## Environment Variables Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `WORKER_SECRET` | Yes | Secret key for API authentication |
| `OPENAI_API_KEY` | Yes | OpenAI API key for Whisper transcription |
| `GEMINI_API_KEY` | Yes | Google Gemini API key for OCR |
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_ANON_KEY` | Yes | Supabase anonymous key |
| `BLOB_READ_WRITE_TOKEN` | Yes | Vercel Blob storage token |
| `PORT` | No | Server port (default: 8080) |
| `NODE_ENV` | No | Node environment (default: production) |
| `GCS_BUCKET` | No | Google Cloud Storage bucket (optional backup) |

## Troubleshooting

### "Frame extraction failed"
- Ensure ffmpeg is installed in the Docker image
- Check available disk space in Cloud Run instance

### "Whisper API error"
- Verify OpenAI API key is valid and has access to Whisper
- Check OpenAI account quota

### "OCR timeout"
- Increase Cloud Run timeout (currently 1 hour)
- Reduce number of frames extracted per video

### "Status persistence issues"
- Verify Supabase URL and key are correct
- Check that `processing_status` table exists
- Ensure table schema matches expected structure

## Performance Notes

- **Memory**: 2GB recommended for video processing
- **Timeout**: 3600 seconds (1 hour) for long videos
- **Concurrent Processing**: Cloud Run auto-scales based on load
- **Frame Extraction**: 1 frame every 5 seconds for OCR

## Database Schema

The Cloud Run worker expects a Supabase table:

```sql
CREATE TABLE processing_status (
  id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  upload_id TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL,
  progress INT DEFAULT 0,
  stage TEXT,
  message TEXT,
  result_url TEXT,
  metadata JSONB,
  started_at TIMESTAMP,
  updated_at TIMESTAMP,
  completed_at TIMESTAMP,
  error_message TEXT
);
```

## Security Considerations

1. **WORKER_SECRET**: Change the secret key regularly
2. **API Keys**: Rotate OpenAI and Gemini keys periodically
3. **Blob Tokens**: Limit token expiry in Vercel Blob settings
4. **Supabase**: Use Row Level Security (RLS) policies
5. **Network**: Consider restricting Cloud Run to specific IPs

## Monitoring

Monitor Cloud Run logs:

```bash
gcloud run logs read video-analyzer-worker --limit 50
```

Key metrics to track:
- Processing success rate
- Average processing time
- API call counts (Whisper, Gemini)
- Storage usage (Blob, Supabase)
