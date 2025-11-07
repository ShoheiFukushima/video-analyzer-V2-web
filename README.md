# Video Analyzer V2 Web

AI-Powered Video Transcription & OCR Web Application

Upload videos and get AI-powered transcription using **Whisper** and OCR using **Gemini Vision**. Results are exported to Excel with timestamps, screenshots, and synchronized text.

## Features

- 🎤 **Whisper AI Transcription** - Accurate speech-to-text with timestamps
- 👁️ **Gemini Vision OCR** - Extract text from video frames
- 📊 **Ideal Excel Format** - Scene-based layout with embedded screenshots
- 🎬 **Scene Detection** - Multi-pass FFmpeg algorithm for accurate scene changes
- 🖼️ **Screenshot Embedding** - Pixel-perfect image placement with aspect ratio preservation
- 🔐 **Clerk Authentication** - Secure user authentication
- ☁️ **Cloud Processing** - Scalable processing on Google Cloud Run
- 📱 **Smartphone Support** - Handles portrait videos, rotation metadata, and 4K content

## Tech Stack

### Frontend (Vercel)
- **Next.js 14** - React framework with App Router
- **TypeScript** - Type safety
- **Tailwind CSS** - Styling
- **Clerk** - Authentication
- **Vercel Blob** - File storage

### Backend (Google Cloud Run)
- **Node.js + Express** - API server
- **FFmpeg** - Video/audio processing
- **OpenAI Whisper API** - Transcription
- **Google Gemini Vision** - OCR
- **ExcelJS** - Report generation

## Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn
- Vercel account
- Google Cloud account (for Cloud Run)
- Clerk account
- OpenAI API key
- Google Gemini API key

### Installation

1. Clone the repository:
```bash
git clone https://github.com/your-username/video-analyzer-V2-web.git
cd video-analyzer-V2-web
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
```bash
cp .env.local.example .env.local
```

Edit `.env.local` and fill in your credentials:
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` - Clerk public key
- `CLERK_SECRET_KEY` - Clerk secret key
- `BLOB_READ_WRITE_TOKEN` - Vercel Blob token
- `CLOUD_RUN_URL` - Cloud Run Worker URL
- `WORKER_SECRET` - Worker authentication secret

4. Run development server:
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Deployment

### Deploy Frontend to Vercel

1. Push your code to GitHub

2. Import the project in Vercel:
   - Go to [vercel.com](https://vercel.com)
   - Click "Add New Project"
   - Import your GitHub repository

3. Configure environment variables in Vercel:
   - `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
   - `CLERK_SECRET_KEY`
   - `BLOB_READ_WRITE_TOKEN`
   - `CLOUD_RUN_URL`
   - `WORKER_SECRET`

4. Deploy!

### Deploy Backend to Cloud Run

See [`cloud-run-worker/DEPLOYMENT_GUIDE.md`](./cloud-run-worker/DEPLOYMENT_GUIDE.md) for detailed Cloud Run deployment instructions.

### Security: Secret Manager Migration (Recommended)

For enhanced security, migrate API keys from plain-text environment variables to GCP Secret Manager:

```bash
# See detailed guide in DEPLOYMENT_DESIGN.md (Secret Manager section)
./scripts/migrate-to-secret-manager.sh
./scripts/verify-secrets.sh
```

This migration provides:
- **Encrypted storage** for sensitive credentials
- **Audit logging** for secret access
- **Version control** for secret rotation
- **IAM-based access control**

See `DEPLOYMENT_DESIGN.md` → "Secret Manager移行ガイド" for complete instructions.

**Quick Start**:
```bash
cd cloud-run-worker
npm run build
docker build -t video-analyzer-worker:latest .
gcloud run deploy video-analyzer-worker \
  --source . \
  --platform managed \
  --region us-central1 \
  --memory 2Gi \
  --timeout 3600
```

## Usage

1. **Sign In** - Use Clerk authentication to sign in
2. **Upload Video** - Drag and drop or select a video file (max 500MB)
3. **Wait for Processing** - Processing takes 2-15 minutes depending on video length
4. **Download Results** - Download the Excel file with transcription and OCR

## Supported Video Formats

- MP4, MOV, AVI
- Portrait and landscape orientation
- Up to 4K resolution
- Stereo or mono audio
- Silent videos (OCR only)

### Video Compression Details

For videos over 200MB, automatic compression is applied to optimize processing and storage:

- **Threshold**: 200MB
- **Codec**: H.264 (libx264)
- **Quality**: CRF 28 (good balance of quality/size)
- **Preset**: fast (optimized for Cloud Run)
- **Audio**: AAC 96kbps (optimized for speech)
- **Optimization**: Web streaming (faststart)
- **Typical reduction**: 40-60%

This ensures efficient processing while maintaining quality for transcription and OCR.

## Excel Output Format (V2.1)

The generated Excel report features an **ideal scene-based layout**:

| Column | Header | Description |
|--------|--------|-------------|
| A | **Scene #** | Sequential scene number (1, 2, 3...) |
| B | **Timecode** | Scene start time (HH:MM:SS) |
| C | **Screenshot** | Embedded PNG at scene mid-point |
| D | **OCR Text** | Text detected by Gemini Vision |
| E | **NA Text** | Narration from Whisper transcription |

### Key Features

- **Scene Detection**: FFmpeg multi-pass algorithm (thresholds: 0.03, 0.05, 0.10)
- **Mid-Point Extraction**: Screenshots taken at 50% between scene changes
- **Time-Based Mapping**: OCR matched by closest timestamp, narration by overlap
- **Aspect Ratio Preservation**: Images maintain video's native aspect ratio
- **Pixel-Perfect Positioning**: EMU units (9525 EMU/pixel) for precise placement

### Example Test

```bash
cd cloud-run-worker
npm run build
node dist/test-ideal-pipeline.js /path/to/video.mp4
```

## Recent Improvements

### V2.1.1 (2025-11-07)
- ✅ **Automatic video compression** - Videos over 200MB are automatically compressed using FFmpeg (CRF 28)
- ✅ **Download timeout extension** - 60s → 300s (5 minutes) for large videos (400MB+)
- ✅ **Download progress logging** - Fixed logging condition for better visibility
- ✅ **Automatic blob cleanup** - Source video and Excel result deletion (Proposal A+B)

### V2.1.0 (2025-10-30)

#### Excel Format Overhaul
- ✅ **Ideal 5-column layout** with embedded screenshots
- ✅ **Scene-based structure** replacing fixed-interval extraction
- ✅ **Multi-pass scene detection** for maximum accuracy
- ✅ **Time-based OCR/narration mapping** to scenes
- ✅ **Statistics worksheet** with coverage metrics

#### Processing Pipeline
- ✅ **Modular architecture** (ffmpeg.ts, excel-generator.ts, pipeline.ts)
- ✅ **E2E testing support** with mock data generators
- ✅ **Automatic frame cleanup** after processing
- ✅ **Processing statistics** calculation

### V2.0.0 (Previous Improvements)
- ✅ **Rotation metadata handling** for portrait smartphone videos
- ✅ **Aspect ratio preservation** (no more distorted frames)
- ✅ **Extended timeouts** for 4K videos (up to 10 minutes)
- ✅ **Buffer limit increases** (50MB for high-resolution videos)
- ✅ **Stereo audio preservation** (no forced mono conversion)
- ✅ **Adjusted VAD thresholds** for smartphone microphones
- ✅ **VAD before audio extraction** to handle silent videos

## Architecture

```
┌─────────────────┐      ┌──────────────────┐      ┌─────────────────┐
│                 │      │                  │      │                 │
│  Next.js Web    │─────▶│  Vercel Blob     │      │  Cloud Run      │
│  (Vercel)       │      │  Storage         │      │  Worker         │
│                 │      │                  │      │                 │
└────────┬────────┘      └──────────────────┘      └────────┬────────┘
         │                                                   │
         │                                                   │
         │  1. Upload video to Blob                         │
         │  2. Trigger processing                           │
         │                                                   │
         └──────────────────────────────────────────────────┘
                  3. Worker processes video
                  4. Returns Excel result URL
```

## Environment Variables

### Frontend (.env.local)
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` - Clerk publishable key
- `CLERK_SECRET_KEY` - Clerk secret key
- `BLOB_READ_WRITE_TOKEN` - Vercel Blob storage token
- `CLOUD_RUN_URL` - Cloud Run Worker URL
- `WORKER_SECRET` - Shared secret for worker authentication

### Backend (Cloud Run)
See [`cloud-run-worker/.env.example`](./cloud-run-worker/.env.example)

## License

MIT

## Credits

- **OpenAI Whisper** - Speech recognition
- **Google Gemini Vision** - OCR
- **Vercel** - Hosting and Blob storage
- **Clerk** - Authentication
- **Google Cloud Run** - Serverless compute
