# Video Analyzer V2 Web - Quick Reference Guide

## File Locations & Responsibilities

| File | Purpose | Key Functions |
|------|---------|---------------|
| `app/page.tsx` | **Main home page** | App entry point, authentication UI, component orchestration |
| `app/layout.tsx` | **Root wrapper** | Clerk + Query providers, global metadata, theme setup |
| `app/components/VideoUploader.tsx` | **Upload UI** | File selection, validation, drag-drop, error handling |
| `app/components/ProcessingStatus.tsx` | **Progress UI** | Status polling, progress display, metadata info |
| `app/api/blob-upload/route.ts` | **Token endpoint** | Generate Vercel Blob upload token, file validation |
| `app/api/process/route.ts` | **Processing trigger** | Validate request, call Cloud Run worker, error handling |
| `app/api/status/[uploadId]/route.ts` | **Status polling** | Query Cloud Run or simulate progress in dev |
| `app/hooks/useVideoUpload.ts` | **Upload logic** | React Query mutation for blob upload |
| `app/hooks/useVideoProcessing.ts` | **Processing logic** | React Query mutation & query for processing/status |
| `app/hooks/useErrorHandler.ts` | **Error utility** | Classify errors, determine retryability |
| `middleware.ts` | **Auth middleware** | Clerk authentication, route protection |

---

## API Endpoints

### 1. POST `/api/blob-upload`
**Purpose**: Get secure token for Vercel Blob direct upload
```
Request:  JSON with file metadata
Response: { clientToken: "...", uploadURL: "..." }
Auth:     Required (Clerk)
```

### 2. POST `/api/process`
**Purpose**: Trigger Cloud Run video processing
```
Request:  { uploadId, blobUrl, fileName, dataConsent }
Response: { success: true, uploadId, message, data }
Auth:     Required (Clerk)
Timeout:  25 seconds
```

### 3. GET `/api/status/[uploadId]`
**Purpose**: Poll processing status
```
Response: { uploadId, status, progress, resultUrl?, metadata? }
Auth:     Required (Clerk)
Timeout:  5 seconds (graceful fallback)
DevMode:  Simulated progress (40s duration)
ProdMode: Real Cloud Run status
```

---

## Component Hierarchy

```
layout.tsx (ClerkProvider + QueryProvider)
└── page.tsx (Main)
    ├── Header (Auth buttons)
    ├── VideoUploader (Drag-drop upload)
    ├── ProcessingStatus (Progress polling)
    └── Features Grid (3-column showcase)
```

---

## Data Flow: Upload → Processing → Download

```
1. User selects file
   ↓ Validation (type, size)
   ↓ VideoUploader.handleUpload()
   
2. Get upload token
   ↓ POST /api/blob-upload
   ↓ Vercel generates token
   
3. Upload to Vercel Blob
   ↓ Direct client-side upload (bypasses Next.js size limit)
   ↓ Get blobUrl from response
   
4. Trigger processing
   ↓ POST /api/process { uploadId, blobUrl, fileName, dataConsent }
   ↓ Next.js validates and forwards to Cloud Run
   ↓ Cloud Run starts async processing
   
5. Poll status
   ↓ GET /api/status/[uploadId] (every 3 seconds)
   ↓ Returns: processing status, progress, resultUrl
   
6. Download results
   ↓ When status === "completed" with resultUrl
   ↓ Click "Download Excel Report"
   ↓ Opens resultUrl (Excel file from Vercel Blob)
```

---

## Error Handling Quick Map

### Client-side (VideoUploader)
- **Network error** → Show message + "Retry" button (retryable)
- **Timeout** → Show message + "Retry" button (retryable)
- **Auth error** → Show message, cannot retry (sign in again)
- **File too large** → Show message, cannot retry (select smaller file)
- **Processing error** → Show message + "Retry" button (retryable)

### Server-side (API routes)
- **401** → User not authenticated
- **400** → Bad request (validation failed)
- **429** → Rate limited (queue full)
- **503** → Cloud Run unavailable
- **504** → Cloud Run timeout (returns graceful fallback)
- **500** → Unexpected server error

---

## Environment Variables Needed

```
# Clerk Authentication
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_***
CLERK_SECRET_KEY=sk_test_***

# Vercel Blob Storage
BLOB_READ_WRITE_TOKEN=vercel_blob_rw_***

# Cloud Run Worker
CLOUD_RUN_URL=https://video-analyzer-worker-*.run.app
WORKER_SECRET=*** (shared secret)
```

---

## Development vs Production

| Feature | Development | Production |
|---------|-------------|-----------|
| Processing simulation | ✅ 40s progress | ❌ Real Cloud Run |
| Real API calls | ❌ Simulated | ✅ Cloud Run endpoint |
| CLOUD_RUN_URL needed | ❌ Optional | ✅ Required |
| Speed | ⚡ Instant | 🐢 2-15 minutes |
| Cost | 💰 Low (no processing) | 💸 Higher (full processing) |

---

## Key Technologies

- **Frontend**: Next.js 14, React 18, TypeScript, Tailwind CSS
- **State**: TanStack React Query (formerly React Query)
- **Auth**: Clerk
- **Storage**: Vercel Blob
- **Backend**: Google Cloud Run (separate service)
- **AI**: OpenAI Whisper + Google Gemini Vision
- **Testing**: Jest + React Testing Library

---

## Processing Pipeline (Cloud Run)

1. **Download** video from Vercel Blob
2. **Extract metadata** (duration, resolution, frame rate)
3. **Voice Activity Detection** (VAD) - detect if audio exists
4. **Extract frames** (scene-based sampling)
5. **Run Whisper AI** on audio for transcription
6. **Run Gemini Vision** on frames for OCR
7. **Generate Excel** report with all data
8. **Upload result** back to Vercel Blob
9. **Return** resultUrl to client

---

## Common Tasks

### Debug Upload Issues
1. Check `VideoUploader.tsx` - `handleUpload()` function
2. Check `/api/blob-upload` - token generation
3. Check browser console for specific error message
4. Use `getErrorMessage()` to understand error type

### Debug Processing Issues
1. Check `/api/process` - validation and Cloud Run call
2. Check `ProcessingStatus.tsx` - polling logic
3. Check `/api/status/[uploadId]` - response format
4. Enable Cloud Run logs: `gcloud functions logs read`

### Test End-to-End
1. Run: `npm run dev`
2. Go to `http://localhost:3000`
3. Sign in with Clerk test account
4. Upload small test video (< 50MB)
5. Wait 40s (dev simulation) or actual time (prod)
6. Download Excel report

---

## Performance Targets

- **Upload**: 5-10s (network dependent)
- **Processing**: 2-15 minutes (video length dependent)
- **Status polling**: ~100ms per request
- **Download**: 5-30s (file size dependent)

---

## Security Checklist

- [ ] WORKER_SECRET never in client code
- [ ] Blob URLs validated (must be Vercel domain)
- [ ] File types validated (video extensions only)
- [ ] File size validated (max 500MB)
- [ ] All API routes require authentication
- [ ] User IDs extracted and validated
- [ ] Data consent captured from user

---

## File Size Impacts

| Size | Upload Time | Processing Time | Download Time |
|------|------------|-----------------|---------------|
| 10MB | 1-2s | 3-5min | 1-2s |
| 50MB | 3-5s | 8-12min | 2-5s |
| 100MB | 5-10s | 12-20min | 5-10s |
| 500MB | 15-30s | 30-60min | 10-30s |

---

This is your quick reference. For deeper dives, see `CODEBASE_STRUCTURE.md`.
