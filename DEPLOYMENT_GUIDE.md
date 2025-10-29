# 🚀 Video Analyzer V2 - Deployment Guide

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│  Vercel (Frontend)                                      │
│  ├─ Next.js 14 + React Query                           │
│  ├─ Clerk Authentication                               │
│  └─ Vercel Blob Storage (client)                       │
│                                                         │
└────────────────┬──────────────────────────────────────┘
                 │
                 │ HTTPS REST API
                 │
┌────────────────▼──────────────────────────────────────┐
│                                                         │
│  Cloud Run (Backend Worker)                            │
│  ├─ FFmpeg (video processing)                          │
│  ├─ OpenAI Whisper (speech recognition)               │
│  ├─ Google Gemini Vision (OCR)                         │
│  └─ ExcelJS (report generation)                        │
│                                                         │
└────────────────┬──────────────────────────────────────┘
                 │
                 ├─ Vercel Blob (store results)
                 │
                 └─ Supabase (optional analytics)
```

---

## Phase 1: Prepare Environment Variables

### 1.1 Get Required Values

```bash
# Clerk
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_***
CLERK_SECRET_KEY=sk_test_***

# Vercel Blob
BLOB_READ_WRITE_TOKEN=vercel_blob_rw_***

# Cloud Run Worker
CLOUD_RUN_URL=https://video-analyzer-worker-*.run.app
WORKER_SECRET=*** (your secret token)

# OpenAI & Gemini (already configured in Cloud Run)
```

### 1.2 Add to Vercel Environment

```bash
vercel env add NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
vercel env add CLERK_SECRET_KEY
vercel env add BLOB_READ_WRITE_TOKEN
vercel env add CLOUD_RUN_URL
vercel env add WORKER_SECRET
```

---

## Phase 2: Deploy to Vercel

### 2.1 Connect GitHub Repository

```bash
vercel link
# Follow prompts to connect your GitHub repo
```

### 2.2 Deploy

```bash
# Build locally to test
npm run build

# Deploy to Vercel
vercel deploy --prod
```

### 2.3 Verify Deployment

```bash
# Check deployment
vercel list

# View logs
vercel logs
```

---

## Phase 3: Verify Cloud Run Integration

### 3.1 Test Cloud Run Worker Health

```bash
curl -X GET https://video-analyzer-worker-*.run.app/health \
  -H "Authorization: Bearer YOUR_WORKER_SECRET"
```

Expected response:
```json
{
  "status": "ok",
  "timestamp": "2025-10-29T...",
  "version": "2.0.0"
}
```

### 3.2 Test Status Endpoint

```bash
# Note: In production, status should come from Cloud Run
# In development, it simulates with time-based progression

curl -X GET https://your-vercel-app.vercel.app/api/status/test_uploadid \
  -H "Authorization: Bearer your_auth_token"
```

---

## Phase 4: End-to-End Testing

### Production Flow

1. **Upload Video**
   - User authenticates via Clerk
   - Selects video file
   - File uploads to Vercel Blob Storage

2. **Send to Processing**
   - Frontend calls `/api/process`
   - API forwards to Cloud Run Worker with `WORKER_SECRET`
   - Cloud Run begins processing (FFmpeg → Whisper → Gemini Vision → Excel)

3. **Poll Status**
   - Frontend polls `/api/status/[uploadId]` every 3 seconds
   - **Development**: Returns simulated progress (40-second demo)
   - **Production**: Returns actual Cloud Run status with real progress

4. **Download Results**
   - When status becomes "completed" with `resultUrl`
   - User sees "Download Excel Report" button
   - Clicking downloads the Excel file from Vercel Blob

---

## Development vs Production Behavior

### Development Mode (npm run dev)

```
/api/status/[uploadId]
├─ Detects NODE_ENV === "development"
├─ Calculates time elapsed from uploadId timestamp
├─ If elapsed < 40s → Returns progress (0→80%)
└─ If elapsed >= 40s → Returns completed status with mock Excel metadata
```

**Example Response (after 20 seconds):**
```json
{
  "uploadId": "upload_1234567890_abc",
  "status": "processing",
  "progress": 40,
  "message": "Processing: 40% complete"
}
```

**Example Response (after 45 seconds):**
```json
{
  "uploadId": "upload_1234567890_abc",
  "status": "completed",
  "progress": 100,
  "message": "Processing completed!",
  "resultUrl": "https://example.com/results/upload_1234567890_abc.xlsx",
  "metadata": {
    "duration": 145.5,
    "segmentCount": 12,
    "ocrResultCount": 48
  }
}
```

### Production Mode (Vercel)

```
/api/status/[uploadId]
├─ NODE_ENV === "production"
├─ Makes request to Cloud Run: /status/[uploadId]
├─ Includes Authorization: Bearer WORKER_SECRET
├─ Returns actual processing status from Cloud Run
└─ On timeout (5s) → Returns graceful fallback
```

**Example Response from Cloud Run:**
```json
{
  "uploadId": "upload_1234567890_abc",
  "status": "completed",
  "resultUrl": "https://blob-store.vercel.app/results/upload_*.xlsx",
  "metadata": {
    "duration": 145.5,
    "segmentCount": 12,
    "ocrResultCount": 48,
    "frames_processed": 456,
    "ocr_accuracy": 94.2
  }
}
```

---

## Error Handling

### Network Timeout
- **Trigger**: Cloud Run doesn't respond within 5 seconds
- **Behavior**: Returns `status: "processing"` instead of failing
- **Frontend**: Continues polling until completion

### Cloud Run Error
- **Trigger**: Cloud Run returns 5xx error
- **Behavior**: API returns graceful message
- **Frontend**: Shows error message but allows retry

### Authentication Error
- **Trigger**: Missing/invalid WORKER_SECRET
- **Behavior**: Returns 401 Unauthorized
- **Fix**: Check environment variables in Vercel dashboard

---

## Monitoring & Debugging

### View Cloud Run Logs

```bash
gcloud functions logs read process \
  --runtime nodejs18 \
  --limit 50
```

### Check Vercel Logs

```bash
# Live logs
vercel logs --follow

# Specific function logs
vercel logs /api/process
vercel logs /api/status
```

### Performance Metrics

- **Upload**: ~5-10s (Vercel Blob upload)
- **Processing**: 2-10 minutes (Cloud Run, varies by video)
- **Status Poll**: ~100ms (lightweight query)
- **Download**: ~5-30s (file size dependent)

---

## Rollback Plan

If deployment fails:

```bash
# Revert to previous deployment
vercel rollback

# Or specify exact deployment
vercel rollback deployment-id
```

---

## Checklist Before Going Live

- [ ] All tests passing locally (`npm test`)
- [ ] Build succeeds locally (`npm run build`)
- [ ] Environment variables set in Vercel dashboard
- [ ] Cloud Run worker is running and accessible
- [ ] Clerk application is configured
- [ ] Vercel Blob storage is active
- [ ] Tested end-to-end flow in staging environment
- [ ] Performance tested with sample videos
- [ ] Error scenarios tested (network, timeout, etc.)
- [ ] Monitoring and alerting configured

---

## FAQ

**Q: Why simulation in development?**
A: Reduces infrastructure costs during development and allows rapid testing without actual video processing.

**Q: Can I test real processing locally?**
A: Yes, set `CLOUD_RUN_URL` to your Cloud Run instance. The API will use real status instead of simulation.

**Q: What if Excel generation fails in Cloud Run?**
A: Frontend receives error status, user can retry. Cloud Run logs will show the specific error.

**Q: How long until Excel is ready?**
A: Typically 2-10 minutes depending on video length and complexity.

**Q: Can I monitor processing progress?**
A: Yes, status API returns real-time progress from Cloud Run.

---

## Support

For issues, check:
1. Vercel logs: `vercel logs`
2. Cloud Run logs: `gcloud functions logs read`
3. GitHub Issues: File bug report with logs

---

**Last Updated**: 2025-10-29
**Status**: ✅ Ready for Production Deployment
