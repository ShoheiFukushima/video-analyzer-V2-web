# Video Analyzer V2 Web - Codebase Architecture Overview

## Project Summary
**Video Analyzer V2 Web** is an AI-powered video transcription and OCR application that processes videos using OpenAI Whisper for transcription and Google Gemini Vision for optical character recognition. Results are exported as comprehensive Excel reports with timestamps, screenshots, and synchronized text.

### Tech Stack
- **Frontend**: Next.js 14 + React + TypeScript + Tailwind CSS (Hosted on Vercel)
- **Authentication**: Clerk
- **File Storage**: Vercel Blob
- **Backend**: Google Cloud Run (separate worker service)
- **AI Services**: OpenAI Whisper, Google Gemini Vision
- **Data Processing**: FFmpeg, ExcelJS

---

## Directory Structure

```
video-analyzer-V2-web/
├── app/
│   ├── api/
│   │   ├── blob-upload/route.ts         # Vercel Blob upload token generation
│   │   ├── process/route.ts             # Trigger Cloud Run video processing
│   │   └── status/[uploadId]/route.ts   # Poll processing status
│   ├── components/
│   │   ├── VideoUploader.tsx            # Video upload UI with drag-drop
│   │   └── ProcessingStatus.tsx         # Processing progress display
│   ├── hooks/
│   │   ├── useVideoUpload.ts            # Upload mutation hook
│   │   ├── useVideoProcessing.ts        # Process & status query hooks
│   │   └── useErrorHandler.ts           # Error classification utility
│   ├── providers/
│   │   └── QueryProvider.tsx            # TanStack Query configuration
│   ├── test-utils/
│   │   └── test-utils.tsx               # Testing utilities
│   ├── layout.tsx                       # Root layout with Clerk provider
│   ├── page.tsx                         # Home page (main entry point)
│   ├── globals.css                      # Global Tailwind styles
│
├── middleware.ts                        # Clerk authentication middleware
├── next.config.js                       # Next.js configuration (500MB limit)
├── tsconfig.json                        # TypeScript configuration
├── package.json                         # Dependencies & scripts
├── jest.config.js                       # Jest testing configuration
├── jest.setup.js                        # Jest setup file
├── tailwind.config.ts                   # Tailwind CSS configuration
├── postcss.config.js                    # PostCSS configuration
│
├── README.md                            # Project overview & setup
├── DEPLOYMENT_GUIDE.md                  # Deployment instructions
├── .env.local.example                   # Environment variables template
└── vercel.json                          # Vercel deployment config
```

---

## Application Flow

### 1. **User Authentication** (Middleware + Layout)
- **File**: `middleware.ts`, `app/layout.tsx`
- **Flow**: 
  - Clerk middleware validates authentication on all non-public routes
  - Public routes: `/`, `/sign-in`, `/sign-up`
  - Protected routes require user to be authenticated
  - Unauthorized users redirected to sign-in

### 2. **Video Upload** (Client-side)
- **Files**: `app/components/VideoUploader.tsx`, `app/hooks/useVideoUpload.ts`
- **Features**:
  - Drag-and-drop file input
  - File validation (video/* type, max 500MB)
  - Real-time upload progress tracking
  - Error classification with retry guidance
  - Data consent checkbox

**Upload Process**:
1. User selects/drags video file
2. Client-side validation (type, size)
3. Request upload token from `/api/blob-upload`
4. Direct upload to Vercel Blob (bypasses 413 errors)
5. Trigger processing via `/api/process`

### 3. **API Routes** (Backend Handlers)

#### `/api/blob-upload` (POST)
- **File**: `app/api/blob-upload/route.ts`
- **Purpose**: Generate secure token for Vercel Blob upload
- **Security**:
  - Clerk authentication required
  - Validates file extension (video formats only)
  - Sets max file size to 500MB
  - Includes user metadata in token payload
- **Response**: Vercel Blob token for client-side direct upload

#### `/api/process` (POST)
- **File**: `app/api/process/route.ts`
- **Purpose**: Trigger Cloud Run worker to process video
- **Request Body**:
  ```json
  {
    "uploadId": "unique_upload_id",
    "blobUrl": "https://blob.vercelusercontent.com/...",
    "fileName": "video.mp4",
    "dataConsent": true|false
  }
  ```
- **Process**:
  1. Validates user authentication
  2. Validates required fields & blob URL format
  3. Forwards to Cloud Run with `WORKER_SECRET` token
  4. Includes 25s timeout (graceful fallback on timeout)
- **Error Handling**:
  - 401: Authentication failed
  - 400: Invalid request
  - 503: Service unavailable
  - 504: Processing timeout (returns graceful message)
  - 429: Queue full (rate limiting)

#### `/api/status/[uploadId]` (GET)
- **File**: `app/api/status/[uploadId]/route.ts`
- **Purpose**: Poll processing status from Cloud Run
- **Development Mode**:
  - Simulates progress based on elapsed time
  - Returns completion after 40 seconds
  - Generates mock Excel metadata
- **Production Mode**:
  - Queries actual Cloud Run worker
  - Returns real-time progress
  - 5s timeout with graceful fallback
- **Response Example**:
  ```json
  {
    "uploadId": "upload_123_abc",
    "status": "completed",
    "progress": 100,
    "resultUrl": "https://...",
    "metadata": {
      "duration": 145.5,
      "segmentCount": 12,
      "ocrResultCount": 48
    }
  }
  ```

### 4. **Processing Status Monitoring** (Real-time)
- **Files**: `app/components/ProcessingStatus.tsx`, `app/hooks/useVideoProcessing.ts`
- **Features**:
  - Polls `/api/status/[uploadId]` every 3 seconds
  - Shows processing stages:
    - downloading, metadata, vad (voice activity detection)
    - audio, frames, whisper, ocr, excel, upload_result, completed
  - Real-time progress bar with percentage
  - Displays metadata (duration, segments, OCR frames)
  - Download button when completed
  - Error state with error message

### 5. **Home Page** (Main UI)
- **File**: `app/page.tsx`
- **Structure**:
  - Header with authentication buttons
  - Signed-out view: Information & sign-in prompt
  - Signed-in view:
    - VideoUploader component
    - ProcessingStatus component (when video uploading)
    - Features showcase (3-column grid)
  - Footer with credits

---

## Key Files & Their Purposes

### Components (UI)

#### `VideoUploader.tsx`
- **Purpose**: Handle video file selection and upload
- **Key Functions**:
  - `handleFileSelect()`: Validate file type & size
  - `handleDrop()`: Drag-and-drop support
  - `handleUpload()`: Execute two-step upload process
  - `getErrorMessage()`: Classify errors with retry guidance
- **Error Types Handled**:
  - Network errors (retryable)
  - Timeout errors (retryable)
  - Authentication errors (not retryable)
  - File size errors (not retryable)
  - Processing errors (retryable)
  - Blob upload errors (retryable)

#### `ProcessingStatus.tsx`
- **Purpose**: Display real-time processing progress
- **Processing Stages**: 9 stages from downloading to completion
- **States**:
  - Loading: Progress bar + status updates
  - Completed: Success message + metadata + download button
  - Error: Error message display
- **Progress Updates**: Polls every 3s, simulates progress as fallback

### Hooks (Business Logic)

#### `useVideoUpload.ts`
- **Purpose**: Handle video file upload to Vercel Blob
- **Features**:
  - TanStack React Query mutation
  - Multipart upload for large files
  - Automatic retry (2 attempts, exponential backoff)
  - Type-safe interfaces for request/response

#### `useVideoProcessing.ts`
- **Purpose**: Handle Cloud Run processing operations
- **Hooks**:
  - `useVideoProcess()`: Trigger processing (mutation)
  - `useProcessingStatus()`: Poll status (query)
- **Features**:
  - Automatic retry logic
  - Exponential backoff
  - Query refetching every 5 seconds
  - Type-safe request/response interfaces

#### `useErrorHandler.ts`
- **Purpose**: Classify and standardize errors
- **Features**:
  - Extracts HTTP status, message, error code
  - Determines if error is retryable
  - Handles Axios errors and generic errors
  - Returns standardized ErrorDetails interface

### API Routes (Server-side)

#### `blob-upload/route.ts`
- **Runtime**: Node.js
- **Security**:
  - Clerk authentication required
  - File type validation (video extensions)
  - File size validation (500MB max)
  - Content-type whitelist
- **Process**:
  - Validates auth
  - Parses request body
  - Calls Vercel `handleUpload()` with custom config
  - Returns secure token for direct client upload

#### `process/route.ts`
- **Runtime**: Node.js (30s timeout)
- **Error Scenarios**:
  - Timeout (504): Service busy
  - Connection error (503): Service unavailable
  - 429: Queue full
  - 5xx: Service error
- **Validation**:
  - Blob URL must be from Vercel
  - Required fields check
  - Environment variables check

#### `status/[uploadId]/route.ts`
- **Runtime**: Node.js
- **Smart Fallback**:
  - 5s timeout on Cloud Run query
  - Returns "processing" status on timeout
  - Prevents API from blocking client
- **Development Mode**:
  - Uses `uploadId` timestamp to calculate elapsed time
  - Simulates 40-second processing duration

### Configuration

#### `layout.tsx`
- Wraps app with `ClerkProvider` and `Providers`
- Sets metadata for SEO
- Configures global styles & theme

#### `middleware.ts`
- Clerk authentication middleware
- Public routes: `/`, `/sign-in/*`, `/sign-up/*`
- Protected routes: everything else
- Automatically redirects unauthenticated users

#### `next.config.js`
- Sets server action body size limit to 500MB
- (Allows large video file handling)

#### `tsconfig.json`
- Target ES2017
- Strict mode enabled
- Path alias `@/*` for absolute imports
- Excludes `cloud-run-worker` from compilation

### Testing Setup

#### `jest.config.js`, `jest.setup.js`
- Jest configured for React + TypeScript
- jsdom environment for component testing
- Test utilities available in `app/test-utils/`

---

## Environment Variables Required

### Frontend (.env.local)
```
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_***
CLERK_SECRET_KEY=sk_test_***
BLOB_READ_WRITE_TOKEN=vercel_blob_rw_***
CLOUD_RUN_URL=https://video-analyzer-worker-*.run.app
WORKER_SECRET=*** (shared secret with Cloud Run)
```

### Features by Environment
- **Development**: Simulated processing with 40-second progression
- **Production**: Real Cloud Run processing with actual status updates

---

## Data Flow Diagram

```
┌─────────────────────────────────────────────────────────┐
│ User Browser (Client-side)                              │
│ ┌──────────────────────────────────────────────────┐   │
│ │ page.tsx (Home)                                  │   │
│ │ ├─ VideoUploader                                │   │
│ │ │ ├─ File selection & validation               │   │
│ │ │ └─ Upload progress tracking                  │   │
│ │ └─ ProcessingStatus                            │   │
│ │   ├─ Polling /api/status every 3s              │   │
│ │   └─ Displaying real-time progress             │   │
│ └──────────────────────────────────────────────────┘   │
│                       │                                  │
│                       │ HTTPS REST                       │
│                       ▼                                  │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│ Vercel (Next.js Backend)                                │
│ ┌──────────────────────────────────────────────────┐   │
│ │ /api/blob-upload (POST)                         │   │
│ │ └─ Generate Vercel Blob upload token            │   │
│ │                                                  │   │
│ │ /api/process (POST)                             │   │
│ │ ├─ Validate request                             │   │
│ │ └─ Forward to Cloud Run Worker                  │   │
│ │                                                  │   │
│ │ /api/status/[uploadId] (GET)                    │   │
│ │ └─ Query Cloud Run or simulate progress         │   │
│ └──────────────────────────────────────────────────┘   │
│                    │              │                     │
│                    │ (BLOB_TOKEN)  │ (WORKER_SECRET)    │
│                    ▼              ▼                     │
└─────────────────────────────────────────────────────────┘

┌──────────────────────┐      ┌──────────────────────┐
│ Vercel Blob Storage  │      │ Cloud Run Worker     │
│ ├─ Video upload      │      │ ├─ Video download    │
│ └─ Result storage    │◀────▶│ ├─ FFmpeg process    │
│                      │      │ ├─ Whisper API       │
│                      │      │ ├─ Gemini Vision     │
│                      │      │ └─ Excel generation  │
└──────────────────────┘      └──────────────────────┘
```

---

## Error Handling Strategy

### Client-side (VideoUploader)
1. **File Validation**
   - Check file type (must start with "video/")
   - Check file size (max 500MB)
   - Show validation error immediately

2. **Upload Error Classification**
   - Network errors → Retryable with message
   - Timeout errors → Retryable (slow internet)
   - Auth errors → Not retryable (re-authenticate)
   - File size errors → Not retryable
   - Processing errors → Retryable (server busy)
   - Blob upload errors → Retryable

3. **User Feedback**
   - Error message displayed in red box
   - "Retry Upload" button for retryable errors
   - Clear guidance on what to do

### Server-side (API Routes)
1. **Authentication**
   - All routes require Clerk auth
   - Return 401 if unauthenticated

2. **Validation**
   - Validate request structure
   - Validate blob URL format (security)
   - Validate file extensions

3. **External Service Calls**
   - Timeouts on Cloud Run queries (graceful fallback)
   - Retry logic on transient failures
   - Proper HTTP status codes (503, 504, 429)

---

## Performance Characteristics

### Upload Performance
- **Blob Upload**: 5-10 seconds (depends on file size & network)
- **Processing Trigger**: ~200ms (quick API call)

### Processing Performance
- **Development Mode**: 40 seconds (simulated)
- **Production Mode**: 2-15 minutes (varies by video length)

### Status Polling
- **Poll Interval**: 3 seconds (client), 5 seconds (query)
- **Timeout**: 5 seconds (graceful fallback)
- **API Response Time**: ~100ms

### Download
- **Depends on**: Excel file size (5-50MB typical)
- **Expected Time**: 5-30 seconds

---

## Security Considerations

1. **Authentication**
   - All API routes protected by Clerk
   - User ID extracted and validated

2. **File Validation**
   - File type whitelist (video extensions)
   - File size limit (500MB)
   - Content-type validation in blob upload

3. **Blob URL Validation**
   - Must originate from Vercel Blob
   - Prevents arbitrary URL processing

4. **Secret Management**
   - `WORKER_SECRET` used for Cloud Run authentication
   - Never exposed to client
   - Included in request headers only

5. **Data Consent**
   - Users explicitly opt-in to analytics storage
   - Only video metadata stored (no video content)

---

## Testing Setup

- **Framework**: Jest with React Testing Library
- **Configuration**: jsdom environment
- **Test Scripts**:
  ```bash
  npm test           # Run all tests
  npm run test:watch # Watch mode
  npm run test:coverage # Coverage report
  ```

---

## Recent Features & Improvements

- Rotation metadata handling for smartphone videos
- Aspect ratio preservation (no distortion)
- Extended timeouts for 4K video processing
- Buffer limit increases for high-resolution
- Stereo audio preservation (no forced mono)
- VAD (Voice Activity Detection) threshold adjustment
- VAD before audio extraction (handles silent videos)
- Smart error classification with retry guidance
- Development mode simulation for rapid testing

---

## Deployment Strategy

### Frontend (Vercel)
1. Push to GitHub
2. Connect repo to Vercel project
3. Set environment variables in Vercel dashboard
4. Deploy automatically on push

### Backend (Cloud Run)
- Separate service in `cloud-run-worker/` directory
- Deployment instructions in `DEPLOYMENT_GUIDE.md`

### Key Deployment Checklist
- All tests passing
- Build succeeds locally
- Environment variables configured
- Cloud Run worker accessible
- Clerk app configured
- Vercel Blob active
- End-to-end testing complete

---

## Summary

**Video Analyzer V2 Web** is a well-architected Next.js application that:
- Handles video uploads with client-side validation
- Integrates with Vercel Blob for scalable storage
- Triggers asynchronous processing on Cloud Run
- Provides real-time status polling with smart fallbacks
- Classifies errors intelligently for better UX
- Supports both development simulation and production use
- Includes comprehensive authentication & security
- Delivers results as Excel reports with AI-extracted data

The codebase follows modern React patterns, has proper error handling, and is optimized for scalability and reliability.
