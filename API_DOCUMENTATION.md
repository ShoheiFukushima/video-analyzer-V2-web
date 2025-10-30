# Video Analyzer V2 - API Documentation

## Overview

Video Analyzer V2 is a production-ready video processing service that provides AI-powered transcription and OCR capabilities. The system processes uploaded videos, extracts audio transcription using OpenAI Whisper, performs OCR on video frames using Google Gemini Vision, and generates downloadable Excel reports.

## Base URL

```
Production: https://video-analyzer-v2.vercel.app
```

## Authentication

All API endpoints (except `/api/health`) require authentication using Clerk. Users must be logged in through the web interface to obtain a valid session token.

### Authentication Flow

1. User logs in via the web interface using Clerk authentication
2. Session token is automatically included in requests from the frontend
3. API endpoints validate the session using `auth()` from `@clerk/nextjs/server`

## API Endpoints

### 1. Health Check

**Endpoint:** `GET /api/health`

**Description:** Returns the overall system health status and individual component statuses.

**Authentication:** Not required (public endpoint)

**Response:**

```json
{
  "status": "healthy | degraded | unhealthy",
  "timestamp": "2025-10-30T12:00:00.000Z",
  "version": "2.0.0",
  "checks": {
    "api": true,
    "blob": true,
    "cloudRun": true,
    "clerk": true
  },
  "errors": ["Optional array of error messages"]
}
```

**Status Codes:**
- `200 OK` - System is healthy or degraded but operational
- `503 Service Unavailable` - System is unhealthy

---

### 2. Blob Upload Token

**Endpoint:** `POST /api/blob-upload`

**Description:** Generates a client token for direct file upload to Vercel Blob Storage.

**Authentication:** Required

**Request Body:**

```json
{
  "filename": "video.mp4",
  "contentType": "video/mp4"
}
```

**Response:**

```json
{
  "uploadUrl": "https://[hash].blob.vercel-storage.com/upload?...",
  "blobUrl": "https://[hash].blob.vercel-storage.com/video.mp4",
  "uploadId": "upload_1730355000123_abc123"
}
```

**Status Codes:**
- `200 OK` - Upload token generated successfully
- `401 Unauthorized` - User not authenticated
- `400 Bad Request` - Invalid request parameters
- `500 Internal Server Error` - Server error

---

### 3. Process Video

**Endpoint:** `POST /api/process`

**Description:** Triggers video processing after successful blob upload.

**Authentication:** Required

**Request Body:**

```json
{
  "uploadId": "upload_1730355000123_abc123",
  "blobUrl": "https://[hash].blob.vercel-storage.com/video.mp4",
  "fileName": "video.mp4",
  "dataConsent": true
}
```

**Validation Rules:**
- `uploadId` and `blobUrl` are required
- `blobUrl` must be from Vercel Blob Storage domains:
  - `*.blob.vercel-storage.com`
  - `*.blob.vercel.com`

**Response:**

```json
{
  "success": true,
  "uploadId": "upload_1730355000123_abc123",
  "message": "Video processing started successfully",
  "status": "processing"
}
```

**Status Codes:**
- `200 OK` - Processing started successfully
- `401 Unauthorized` - User not authenticated
- `400 Bad Request` - Invalid Blob URL or missing required fields
- `500 Internal Server Error` - Failed to start processing

---

### 4. Check Processing Status

**Endpoint:** `GET /api/status/{uploadId}`

**Description:** Returns the current processing status and progress.

**Authentication:** Required

**URL Parameters:**
- `uploadId` - The unique identifier returned from blob upload

**Response (Processing):**

```json
{
  "uploadId": "upload_1730355000123_abc123",
  "status": "processing",
  "progress": 45,
  "stage": "whisper",
  "message": "Processing: whisper..."
}
```

**Response (Completed):**

```json
{
  "uploadId": "upload_1730355000123_abc123",
  "status": "completed",
  "progress": 100,
  "stage": "completed",
  "resultUrl": "/api/dummy-excel/upload_1730355000123_abc123",
  "metadata": {
    "duration": 120.5,
    "segmentCount": 8,
    "ocrResultCount": 12,
    "transcriptionLength": 2543
  }
}
```

**Processing Stages:**
1. `downloading` - Downloading video from blob storage
2. `metadata` - Extracting video metadata
3. `vad` - Voice Activity Detection
4. `frames` - Extracting video frames
5. `whisper` - Audio transcription (OpenAI Whisper)
6. `ocr` - Text extraction from frames (Gemini Vision)
7. `excel` - Generating Excel report
8. `upload_result` - Uploading results
9. `completed` - Processing complete

**Status Codes:**
- `200 OK` - Status retrieved successfully
- `401 Unauthorized` - User not authenticated
- `404 Not Found` - Upload ID not found
- `500 Internal Server Error` - Server error

---

### 5. Download Excel Report

**Endpoint:** `GET /api/dummy-excel/{uploadId}`

**Description:** Downloads the generated Excel report after processing is complete.

**Authentication:** Required

**URL Parameters:**
- `uploadId` - The unique identifier from processing

**Response:**
- Binary Excel file (`.xlsx` format)
- Content-Type: `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
- Content-Disposition: `attachment; filename="video-analysis-{uploadId}.xlsx"`

**Excel Report Structure:**
- **Sheet 1: Summary** - Overview of the analysis
- **Sheet 2: Transcription** - Time-coded speech transcription
- **Sheet 3: OCR Results** - Text extracted from video frames
- **Sheet 4: Full Analysis** - Combined timeline of all content

**Status Codes:**
- `200 OK` - Excel file returned successfully
- `401 Unauthorized` - User not authenticated
- `404 Not Found` - Report not found
- `500 Internal Server Error` - Failed to generate report

---

## Error Response Format

All error responses follow this standard format:

```json
{
  "error": "Error Type",
  "message": "Detailed error message for debugging",
  "uploadId": "Optional - relevant upload ID if applicable"
}
```

## Error Codes

| Code | Type | Description |
|------|------|-------------|
| 400 | Bad Request | Invalid request parameters or malformed JSON |
| 401 | Unauthorized | Authentication required or invalid session |
| 403 | Forbidden | Insufficient permissions |
| 404 | Not Found | Resource not found |
| 405 | Method Not Allowed | HTTP method not supported for endpoint |
| 413 | Payload Too Large | File size exceeds limit |
| 429 | Too Many Requests | Rate limit exceeded |
| 500 | Internal Server Error | Server processing error |
| 502 | Bad Gateway | Cloud Run worker unreachable |
| 503 | Service Unavailable | System unhealthy or maintenance |
| 504 | Gateway Timeout | Processing timeout |

## Rate Limiting

**Current Limits:**
- API calls: 100 requests per minute per user
- File uploads: 10 files per hour per user
- Maximum file size: 500MB per video
- Processing timeout: 5 minutes per video

## Architecture Overview

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Frontend   │────▶│  Vercel API  │────▶│  Cloud Run   │
│   (Next.js)  │     │   (Edge)     │     │   Worker     │
└──────────────┘     └──────────────┘     └──────────────┘
        │                    │                    │
        ▼                    ▼                    ▼
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│    Clerk     │     │ Blob Storage │     │   Whisper    │
│    Auth      │     │   (Vercel)   │     │   Gemini     │
└──────────────┘     └──────────────┘     └──────────────┘
```

## Integration Flow

1. **Authentication**: User logs in via Clerk
2. **Upload**: Frontend requests upload token from `/api/blob-upload`
3. **Direct Upload**: File uploaded directly to Vercel Blob Storage
4. **Processing**: `/api/process` triggers Cloud Run worker
5. **Status Polling**: Frontend polls `/api/status/{id}` for progress
6. **Download**: Completed report available at `/api/dummy-excel/{id}`

## Environment Variables

Required environment variables for deployment:

```env
# Vercel Blob Storage
BLOB_READ_WRITE_TOKEN=vercel_blob_rw_...

# Clerk Authentication
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...

# Cloud Run Worker
CLOUD_RUN_URL=https://video-analyzer-worker-...
WORKER_SECRET=secret_key_...

# Environment
NODE_ENV=production
```

## Testing

### Integration Test

```bash
# Run full integration test suite
bash scripts/integration-test.sh

# Test with custom base URL
BASE_URL=http://localhost:3000 bash scripts/integration-test.sh
```

### Monitoring

```bash
# Start real-time monitoring dashboard
bash scripts/monitor.sh

# Custom refresh interval (seconds)
REFRESH_INTERVAL=10 bash scripts/monitor.sh
```

### Unit Tests

```bash
# Run Jest test suite
npm test

# Run with coverage
npm run test:coverage
```

## Security Considerations

1. **Authentication**: All sensitive endpoints require Clerk authentication
2. **Input Validation**: Strict validation on all user inputs
3. **Blob URL Verification**: Only accept URLs from Vercel Blob domains
4. **Rate Limiting**: Prevents abuse and DoS attacks
5. **Error Messages**: No sensitive information exposed in errors
6. **HTTPS Only**: All production traffic encrypted
7. **CORS**: Configured for production domain only

## Support

For issues or questions:
- GitHub Issues: [Repository Issues](https://github.com/your-repo/issues)
- Email: support@example.com

## Changelog

### Version 2.0.0 (2025-10-30)
- Added Clerk authentication to all endpoints
- Fixed Blob URL validation for vercel-storage domain
- Implemented Cloud Run integration for production
- Added comprehensive health check endpoint
- Enhanced security with proper error handling
- Added rate limiting and monitoring capabilities

### Version 1.0.0 (2025-10-27)
- Initial release with MVP functionality
- Basic video upload and processing
- Dummy Excel report generation