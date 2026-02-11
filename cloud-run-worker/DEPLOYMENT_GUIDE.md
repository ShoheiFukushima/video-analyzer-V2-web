# Cloud Run Worker Deployment Guide

**最終更新**: 2026年2月5日

## Overview

This is the backend worker service that processes uploaded videos. It handles:
- Video download from Cloudflare R2 storage
- Audio extraction and transcription (OpenAI Whisper)
- Frame extraction and OCR (Google Gemini Vision)
- Excel report generation
- Result file upload back to R2

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

#### Option A: Using gcloud CLI (推奨)

```bash
# Authenticate with Google Cloud
gcloud auth login
gcloud config set project YOUR-PROJECT-ID

# Deploy with optimized settings (2026-02-10 updated)
# Timeout extended to 3600s (1 hour) for long video processing
gcloud run deploy video-analyzer-worker \
  --source . \
  --platform managed \
  --region us-central1 \
  --memory 4Gi \
  --cpu 4 \
  --timeout 3600 \
  --max-instances 10 \
  --concurrency 1 \
  --no-cpu-throttling \
  --execution-environment gen2 \
  --allow-unauthenticated
```

**重要な設定オプション**:
- `--cpu 4`: FFmpeg処理に必要な十分なCPU
- `--memory 4Gi`: CPUに合わせて増加
- `--timeout 3600`: **1時間タイムアウト（2GB動画対応）**
- `--concurrency 1`: 動画処理はリソース集約型なので1リクエストずつ
- `--no-cpu-throttling`: 常時CPUを割り当て（スロットリング無効）
- `--execution-environment gen2`: gVisorではなくLinux VM（FFmpegハング回避）

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

## Performance Notes (2026-02-05 Updated)

| 設定 | 推奨値 | 説明 |
|-----|-------|------|
| **CPU** | 4 vCPU | FFmpeg処理に最適化 |
| **Memory** | 4 GB | CPU に合わせて増加 |
| **Concurrency** | 1 | 動画処理は1リクエストずつ |
| **CPUスロットリング** | 無効 | 常時フルパワー |
| **実行環境** | gen2 | Linux VM（gVisorではない） |
| **Timeout** | 3600秒 | 1時間（2GB/10時間動画対応） |

**重要**:
- gen2実行環境を使用することで、FFmpeg/ffprobeのハング問題を回避
- CPUスロットリングを無効にすることで、処理速度が10-50倍向上

## Long Video Processing (Checkpoint System)

2026年2月10日追加: 2GB/10時間以上の動画に対応するためのチェックポイント機能

### 概要
- **タイムアウト**: 3600秒（1時間）
- **チェックポイント保存**: Tursoに定期保存
- **中間ファイル**: Cloudflare R2に保存
- **自動再開**: 中断箇所から自動的に再開

### チェックポイント保存タイミング
| ステップ | 保存間隔 |
|---------|---------|
| Whisper処理 | 50チャンク毎 |
| OCR処理 | 100シーン毎 |
| シーン検出完了 | 完了時 |

### 中間ファイルパス構造
```
uploads/{userId}/{uploadId}/
  ├── source.mp4          # ソース動画
  ├── audio.mp3           # 抽出音声
  └── frames/             # 抽出フレーム
```

### チェックポイント有効期限
- **7日間**: 7日後に自動削除（Turso + R2）

### 処理時間見積もり（2GB/10時間動画）
| ステップ | 所要時間 |
|---------|---------|
| R2ダウンロード | 2-5分 |
| 音声抽出 | 3-5分 |
| VAD + Whisper | 20-40分 |
| シーン検出 | 5-10分 |
| OCR処理 | 10-20分 |
| Excel生成 | 2-3分 |
| **合計** | **約1.5時間** |

### 環境変数（追加）
| Variable | Required | Description |
|----------|----------|-------------|
| `TURSO_DATABASE_URL` | Yes (Production) | Turso database URL |
| `TURSO_AUTH_TOKEN` | Yes (Production) | Turso auth token |

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
