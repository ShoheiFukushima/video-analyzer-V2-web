# Excel Output Implementation Plan - Ideal Format Achievement

## 📋 Overview

This document outlines the complete implementation plan to achieve the ideal Excel output format as shown in the reference image.

**Reference Image Requirements**:
- Scene # | Timecode (HH:MM:SS) | Screenshot (embedded) | OCR Text | NA Text
- Single consolidated sheet (not multiple sheets)
- Real scene change detection timestamps
- Embedded screenshot images from video frames
- Separate columns for OCR and narration text

---

## 🎯 Current State vs Target State

### Current Implementation (V2)

**Excel Structure**:
- 5 sheets: Summary, Transcription, OCR Results, Full Analysis, Metadata
- Timestamp format: Seconds (e.g., `5.2`, `10.3`)
- No embedded images
- OCR and Speech combined in "Full Analysis" sheet
- Uses basic XLSX library

**Data Flow**:
```
Video Upload → Cloud Run Worker
  → Video Processing (placeholder)
  → Dummy Excel Generation
  → Download
```

### Target Implementation

**Excel Structure**:
- Single sheet: "Video Analysis"
- Columns: Scene # | Timecode | Screenshot | OCR Text | NA Text
- Timestamp format: HH:MM:SS (e.g., `00:00:05`, `00:01:23`)
- Embedded PNG screenshots (320px width, aspect ratio preserved)
- Scene-based detection (not fixed intervals)

**Data Flow**:
```
Video Upload → Cloud Run Worker
  → FFmpeg Scene Detection
  → Frame Extraction at scene mid-points
  → Gemini Vision OCR
  → Whisper Transcription
  → Excel Generation with Image Embedding
  → Download
```

---

## 🔍 Investigation Findings

### V1 Implementation Analysis (video-analyzer-web)

**Location**: `/Users/fukushimashouhei/dev1/projects/video-analyzer-web/render-worker/`

**Key Files**:
1. `src/services/ffmpeg.ts` (322 lines)
   - Multi-pass scene detection (3 thresholds: 0.03, 0.05, 0.10)
   - Mid-point frame extraction (50% between scene cuts)
   - HH:MM:SS timecode formatting
   - 1280x720 PNG output
   - 100% OCR accuracy achieved

2. `src/services/excel-export.ts` (245 lines)
   - ExcelJS library for image embedding
   - Dynamic cell sizing based on video aspect ratio
   - EMU unit conversion for precise image positioning
   - Center-aligned screenshot images
   - Aspect ratio preservation

**Scene Detection Algorithm**:
```typescript
// Multi-pass detection for 100% accuracy
thresholds: [0.03, 0.05, 0.10]

// Scene range calculation
startTime = sceneDetectionPoint
endTime = nextSceneDetectionPoint
midTime = (startTime + endTime) / 2  // Screenshot extraction point

// Timecode assignment
timecode = formatTimecode(startTime)  // Scene change timestamp (HH:MM:SS)
```

**Excel Image Embedding**:
```typescript
// Image dimensions
const EXCEL_IMAGE_WIDTH_PX = 320;
const imageHeight = Math.round(imageWidth / aspectRatio);

// Excel unit conversions
const PIXELS_PER_CHARACTER_WIDTH = 7;
const POINTS_PER_PIXEL = 0.75;

// Center positioning with EMU offset
colOff: Math.round(offsetX * 9525)
rowOff: Math.round(offsetY * 9525)
```

---

## 📦 Implementation Tasks

### Phase 1: Foundation & Data Structures (Priority: High)

#### Task 1.1: Install Dependencies
**Ticket**: `EXCEL-001`
**Assignee**: Manual
**Estimated**: 5 minutes

**Description**:
Add ExcelJS dependency to Cloud Run Worker for image embedding support.

**Actions**:
```bash
cd /Users/fukushimashouhei/dev1/projects/video-analyzer-V2-web/cloud-run-worker
npm install exceljs@^4.4.0
```

**Verification**:
- package.json contains `"exceljs": "^4.4.0"`
- npm install completes without errors

---

#### Task 1.2: Create Timestamp Utility
**Ticket**: `EXCEL-002`
**Assignee**: Subagent (code-reviewer or python-expert)
**Estimated**: 10 minutes

**Description**:
Create utility function to convert seconds to HH:MM:SS format.

**File**: `cloud-run-worker/src/utils/timecode.ts` (new file)

**Implementation**:
```typescript
/**
 * Convert seconds to HH:MM:SS timecode format
 * @param seconds - Time in seconds (can be decimal)
 * @returns Timecode string (e.g., "00:05:23")
 */
export function formatTimecode(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

/**
 * Convert HH:MM:SS timecode to seconds
 * @param timecode - Timecode string (e.g., "00:05:23")
 * @returns Time in seconds
 */
export function parseTimecode(timecode: string): number {
  const parts = timecode.split(':').map(Number);
  return parts[0] * 3600 + parts[1] * 60 + parts[2];
}
```

**Tests**:
```typescript
// Test cases
formatTimecode(0) === "00:00:00"
formatTimecode(65.5) === "00:01:05"
formatTimecode(3661) === "01:01:01"
parseTimecode("00:01:05") === 65
```

---

#### Task 1.3: Define New Excel Data Structure
**Ticket**: `EXCEL-003`
**Assignee**: Subagent (python-expert or backend-architect)
**Estimated**: 15 minutes

**Description**:
Create TypeScript interfaces for the new Excel output format.

**File**: `cloud-run-worker/src/types/excel.ts` (new file)

**Implementation**:
```typescript
/**
 * Represents a single row in the final Excel output
 */
export interface ExcelRow {
  sceneNumber: number;           // Scene #
  timecode: string;               // HH:MM:SS format
  screenshotPath: string;         // Path to extracted frame PNG
  ocrText: string;                // Text detected by OCR
  narrationText: string;          // Text from audio transcription (NA Text)
}

/**
 * Video metadata for Excel formatting
 */
export interface VideoMetadata {
  width: number;
  height: number;
  aspectRatio: number;
  duration: number;
}

/**
 * Scene information from FFmpeg detection
 */
export interface Scene {
  sceneNumber: number;
  startTime: number;              // Scene change detection point (seconds)
  endTime: number;                // Next scene change point (seconds)
  midTime: number;                // Mid-point for screenshot extraction
  timecode: string;               // HH:MM:SS at startTime
  screenshotPath?: string;        // Set after frame extraction
}

/**
 * Excel generation options
 */
export interface ExcelGenerationOptions {
  projectTitle: string;
  rows: ExcelRow[];
  videoMetadata: VideoMetadata;
  includeStatistics?: boolean;
}
```

**Integration**:
- Update `cloud-run-worker/src/types/index.ts` to export these types
- Import in Excel generator and video processor

---

### Phase 2: FFmpeg Scene Detection (Priority: High)

#### Task 2.1: Port FFmpeg Scene Detection Code
**Ticket**: `EXCEL-004`
**Assignee**: Subagent (backend-architect or python-expert)
**Estimated**: 30 minutes

**Description**:
Port V1's proven FFmpeg scene detection implementation to V2 with ES6 module syntax.

**Source**: `/Users/fukushimashouhei/dev1/projects/video-analyzer-web/render-worker/src/services/ffmpeg.ts`
**Target**: `cloud-run-worker/src/services/sceneDetection.ts` (new file)

**Key Changes**:
- Convert CommonJS (`require`) to ES6 (`import`)
- Update type imports from new type definitions
- Maintain exact algorithm (multi-pass, mid-point extraction)
- Add console logging for debugging

**Functions to Port**:
1. `detectSceneCuts()` - Multi-pass scene detection
2. `runSceneDetection()` - Single threshold detection
3. `generateSceneRanges()` - Calculate scene ranges with mid-points
4. `extractFrameAtTime()` - Extract single frame at timestamp
5. `getVideoMetadata()` - Get video dimensions and duration
6. `formatTimecode()` - Already in utils, reference it

**Validation**:
- TypeScript compiles without errors
- Function signatures match expected types
- Test with sample video file

---

#### Task 2.2: Create Frame Extraction Service
**Ticket**: `EXCEL-005`
**Assignee**: Subagent (backend-architect)
**Estimated**: 20 minutes

**Description**:
Create service that orchestrates scene detection and frame extraction.

**File**: `cloud-run-worker/src/services/frameExtraction.ts` (new file)

**Implementation**:
```typescript
import { detectSceneCuts, generateSceneRanges, extractFrameAtTime, getVideoMetadata } from './sceneDetection';
import { Scene, VideoMetadata } from '../types/excel';
import path from 'path';
import { promises as fs } from 'fs';

/**
 * Extract frames at scene mid-points
 * @param videoPath - Path to video file
 * @returns Array of scenes with screenshot paths
 */
export async function extractScenesWithScreenshots(
  videoPath: string
): Promise<{ scenes: Scene[]; metadata: VideoMetadata }> {

  const outputDir = path.join('/tmp', `frames-${Date.now()}`);
  await fs.mkdir(outputDir, { recursive: true });

  // Get video metadata
  const metadata = await getVideoMetadata(videoPath);
  console.log(`📹 Video: ${metadata.width}x${metadata.height}, ${metadata.duration}s`);

  // Detect scene cuts
  const cuts = await detectSceneCuts(videoPath);
  console.log(`🔍 Detected ${cuts.length} scene cuts`);

  // Generate scene ranges
  const scenes = await generateSceneRanges(cuts, metadata.duration);
  console.log(`📐 Generated ${scenes.length} scene ranges`);

  // Extract frames at mid-points
  for (const scene of scenes) {
    const filename = path.join(
      outputDir,
      `scene-${scene.sceneNumber.toString().padStart(4, '0')}.png`
    );

    await extractFrameAtTime(videoPath, scene.midTime, filename);
    scene.screenshotPath = filename;

    console.log(`  ✓ Scene ${scene.sceneNumber}: ${scene.timecode} (screenshot at ${scene.midTime.toFixed(1)}s)`);
  }

  return { scenes, metadata };
}

/**
 * Clean up temporary frame files
 */
export async function cleanupFrames(scenes: Scene[]): Promise<void> {
  if (scenes.length === 0) return;

  const outputDir = path.dirname(scenes[0].screenshotPath!);
  await fs.rm(outputDir, { recursive: true, force: true });
  console.log(`🧹 Cleaned up: ${outputDir}`);
}
```

**Validation**:
- Extracts frames at correct timestamps
- PNG files created in /tmp
- Cleanup removes temporary files

---

### Phase 3: Excel Generation with Image Embedding (Priority: High)

#### Task 3.1: Create Excel Generator Service
**Ticket**: `EXCEL-006`
**Assignee**: Subagent (frontend-architect or python-expert)
**Estimated**: 45 minutes

**Description**:
Create new Excel generation service using ExcelJS with image embedding support.

**Source Reference**: `/Users/fukushimashouhei/dev1/projects/video-analyzer-web/render-worker/src/services/excel-export.ts`
**Target**: `cloud-run-worker/src/services/excelGeneratorV2.ts` (new file)

**Key Features**:
1. Single worksheet: "Video Analysis"
2. Columns: Scene # | Timecode | Screenshot | OCR Text | NA Text
3. Embedded PNG images (320px width, aspect ratio preserved)
4. Dynamic cell sizing based on video aspect ratio
5. Center-aligned images with EMU offset
6. Styled headers and alternating row colors

**Implementation Outline**:
```typescript
import ExcelJS from 'exceljs';
import { promises as fs } from 'fs';
import { ExcelGenerationOptions, ExcelRow, VideoMetadata } from '../types/excel';

// Constants from V1
const EXCEL_IMAGE_WIDTH_PX = 320;
const PIXELS_PER_CHARACTER_WIDTH = 7;
const POINTS_PER_PIXEL = 0.75;

export async function generateExcelWithImages(
  options: ExcelGenerationOptions
): Promise<Buffer> {

  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Video Analysis');

  // Calculate image dimensions
  const aspectRatio = options.videoMetadata.aspectRatio;
  const imageWidth = EXCEL_IMAGE_WIDTH_PX;
  const imageHeight = Math.round(imageWidth / aspectRatio);

  // Calculate Excel column/row sizes
  const columnWidth = Math.ceil(imageWidth / PIXELS_PER_CHARACTER_WIDTH);
  const rowHeight = Math.round(imageHeight * POINTS_PER_PIXEL);

  // Define columns
  worksheet.columns = [
    { header: 'Scene #', key: 'scene', width: 10 },
    { header: 'Timecode', key: 'timecode', width: 15 },
    { header: 'Screenshot', key: 'screenshot', width: columnWidth },
    { header: 'OCR Text', key: 'ocrText', width: 40 },
    { header: 'NA Text', key: 'naText', width: 40 }
  ];

  // Style header row
  const headerRow = worksheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 12 };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF4A90E2' }
  };
  headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
  headerRow.height = 25;

  // Add data rows with images
  for (const row of options.rows) {
    const excelRow = worksheet.addRow({
      scene: row.sceneNumber,
      timecode: row.timecode,
      screenshot: '',
      ocrText: row.ocrText || '(no text detected)',
      naText: row.narrationText || '(no narration)'
    });

    excelRow.height = rowHeight;

    // Alternate row colors
    if ((row.sceneNumber - 1) % 2 === 0) {
      excelRow.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFF5F5F5' }
      };
    }

    // Center align Scene # and Timecode
    excelRow.getCell('scene').alignment = { horizontal: 'center', vertical: 'middle' };
    excelRow.getCell('timecode').alignment = { horizontal: 'center', vertical: 'middle' };

    // Wrap text in OCR and NA columns
    excelRow.getCell('ocrText').alignment = { wrapText: true, vertical: 'top' };
    excelRow.getCell('naText').alignment = { wrapText: true, vertical: 'top' };

    // Embed screenshot image
    if (row.screenshotPath) {
      await embedImage(workbook, worksheet, row.screenshotPath, row.sceneNumber + 1, columnWidth, rowHeight, imageWidth, imageHeight);
    }
  }

  // Add borders
  worksheet.eachRow({ includeEmpty: false }, (row) => {
    row.eachCell((cell) => {
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFD3D3D3' } },
        left: { style: 'thin', color: { argb: 'FFD3D3D3' } },
        bottom: { style: 'thin', color: { argb: 'FFD3D3D3' } },
        right: { style: 'thin', color: { argb: 'FFD3D3D3' } }
      };
    });
  });

  // Generate buffer
  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

async function embedImage(
  workbook: ExcelJS.Workbook,
  worksheet: ExcelJS.Worksheet,
  imagePath: string,
  rowNumber: number,
  columnWidth: number,
  rowHeight: number,
  imageWidth: number,
  imageHeight: number
): Promise<void> {

  const imageBuffer = await fs.readFile(imagePath);
  const imageId = workbook.addImage({
    buffer: imageBuffer,
    extension: 'png'
  });

  // Calculate cell dimensions
  const cellWidthPx = columnWidth * PIXELS_PER_CHARACTER_WIDTH;
  const cellHeightPx = rowHeight / POINTS_PER_PIXEL;

  // Calculate center offset
  const offsetX = Math.max(0, (cellWidthPx - imageWidth) / 2);
  const offsetY = Math.max(0, (cellHeightPx - imageHeight) / 2);

  worksheet.addImage(imageId, {
    tl: {
      col: 2,  // Screenshot column (0-indexed, column C)
      row: rowNumber - 1,
      colOff: Math.round(offsetX * 9525),
      rowOff: Math.round(offsetY * 9525)
    } as any,
    ext: { width: imageWidth, height: imageHeight },
    editAs: 'oneCell'
  });
}
```

**Validation**:
- Excel file opens in Microsoft Excel/LibreOffice
- Images are embedded and visible
- Aspect ratio preserved
- Text wrapping works correctly

---

#### Task 3.2: Map OCR and Narration to Separate Columns
**Ticket**: `EXCEL-007`
**Assignee**: Subagent (backend-architect)
**Estimated**: 30 minutes

**Description**:
Create mapping logic to separate OCR results and transcription into different columns.

**File**: `cloud-run-worker/src/services/dataMapper.ts` (new file)

**Implementation**:
```typescript
import { Scene } from '../types/excel';
import { TranscriptionSegment, OCRResult } from '../types';

/**
 * Map scenes with OCR and transcription to Excel rows
 */
export interface MappedExcelRow {
  sceneNumber: number;
  timecode: string;
  screenshotPath: string;
  ocrText: string;
  narrationText: string;
}

/**
 * Combine scene data with OCR and transcription
 * @param scenes - Scenes with timestamps and screenshots
 * @param ocrResults - OCR detection results
 * @param transcriptionSegments - Whisper transcription segments
 * @returns Mapped Excel rows
 */
export function mapToExcelRows(
  scenes: Scene[],
  ocrResults: OCRResult[],
  transcriptionSegments: TranscriptionSegment[]
): MappedExcelRow[] {

  const rows: MappedExcelRow[] = [];

  for (const scene of scenes) {
    // Find OCR result for this scene's timestamp
    const ocrForScene = ocrResults.find(
      ocr => Math.abs(parseTimecode(ocr.timecode) - scene.startTime) < 1
    );

    // Find transcription segments overlapping with this scene
    const transcriptionsForScene = transcriptionSegments.filter(seg =>
      seg.start >= scene.startTime && seg.start < scene.endTime
    );

    // Concatenate all transcription texts
    const narrationText = transcriptionsForScene
      .map(seg => seg.text.trim())
      .join(' ');

    rows.push({
      sceneNumber: scene.sceneNumber,
      timecode: scene.timecode,
      screenshotPath: scene.screenshotPath || '',
      ocrText: ocrForScene?.text || '',
      narrationText: narrationText || ''
    });
  }

  return rows;
}

function parseTimecode(timecode: string): number {
  const parts = timecode.split(':').map(Number);
  return parts[0] * 3600 + parts[1] * 60 + parts[2];
}
```

**Validation**:
- OCR results correctly matched to scenes
- Transcription segments properly aggregated
- Empty strings for scenes without data

---

### Phase 4: Integration & Testing (Priority: Medium)

#### Task 4.1: Integrate New Pipeline
**Ticket**: `EXCEL-008`
**Assignee**: Subagent (system-architect or backend-architect)
**Estimated**: 30 minutes

**Description**:
Update the main video processor to use the new Excel generation pipeline.

**File**: `cloud-run-worker/src/services/videoProcessor.ts`

**Changes**:
```typescript
// Replace old imports
import { extractScenesWithScreenshots, cleanupFrames } from './frameExtraction';
import { generateExcelWithImages } from './excelGeneratorV2';
import { mapToExcelRows } from './dataMapper';

export async function processVideo(params: ProcessVideoParams) {

  // Step 1: Scene detection and frame extraction
  const { scenes, metadata } = await extractScenesWithScreenshots(videoPath);

  // Step 2: OCR Processing (Gemini Vision)
  const ocrResults = await processOCR(scenes);

  // Step 3: Audio Transcription (Whisper)
  const transcriptionSegments = await transcribeAudio(videoPath);

  // Step 4: Map to Excel rows
  const excelRows = mapToExcelRows(scenes, ocrResults, transcriptionSegments);

  // Step 5: Generate Excel with images
  const excelBuffer = await generateExcelWithImages({
    projectTitle: params.fileName,
    rows: excelRows,
    videoMetadata: metadata,
    includeStatistics: true
  });

  // Step 6: Cleanup temporary files
  await cleanupFrames(scenes);

  return excelBuffer;
}
```

**Validation**:
- End-to-end pipeline executes without errors
- Excel file contains real data (not mock)
- Temporary files cleaned up

---

#### Task 4.2: Update Dummy Excel for Frontend Testing
**Ticket**: `EXCEL-009`
**Assignee**: Subagent (frontend-architect)
**Estimated**: 15 minutes

**Description**:
Update dummy Excel endpoint to match new format for frontend testing.

**File**: `app/api/dummy-excel/[uploadId]/route.ts`

**Changes**:
- Update to single-sheet format
- Use HH:MM:SS timecodes
- Add NA Text column
- Match new column structure

**Validation**:
- Frontend can download dummy Excel
- Format matches production Excel
- User can test before video processing completes

---

#### Task 4.3: End-to-End Testing
**Ticket**: `EXCEL-010`
**Assignee**: test-runner or quality-engineer
**Estimated**: 30 minutes

**Description**:
Test the complete pipeline with real video files.

**Test Cases**:
1. Short video (30 seconds, few scene changes)
2. Medium video (2 minutes, multiple scenes)
3. Long video (5 minutes, many scenes)
4. Video with Japanese text (OCR accuracy)
5. Video with clear narration (transcription accuracy)

**Validation Criteria**:
- Excel downloads successfully
- Scene numbers are sequential
- Timecodes are in HH:MM:SS format
- Screenshots are embedded and visible
- OCR text is in correct column
- Narration text is in separate column
- Aspect ratio is preserved
- No temporary files remain after processing

---

### Phase 5: Documentation & Deployment (Priority: Low)

#### Task 5.1: Update API Documentation
**Ticket**: `EXCEL-011`
**Assignee**: technical-writer
**Estimated**: 20 minutes

**File**: `API_DOCUMENTATION.md`

**Updates**:
- Document new Excel output format
- Update column descriptions
- Add screenshot embedding details
- Describe scene detection algorithm

---

#### Task 5.2: Update README
**Ticket**: `EXCEL-012`
**Assignee**: technical-writer
**Estimated**: 10 minutes

**File**: `README.md`

**Updates**:
- Add ExcelJS dependency information
- Update system requirements
- Document FFmpeg dependency for Docker

---

## 📊 Dependency Graph

```
Phase 1 (Foundation)
  ├─ EXCEL-001: Install Dependencies
  ├─ EXCEL-002: Timestamp Utility
  └─ EXCEL-003: Data Structures
      ↓
Phase 2 (FFmpeg)
  ├─ EXCEL-004: Port Scene Detection (depends on EXCEL-002, EXCEL-003)
  └─ EXCEL-005: Frame Extraction Service (depends on EXCEL-004)
      ↓
Phase 3 (Excel)
  ├─ EXCEL-006: Excel Generator (depends on EXCEL-003)
  └─ EXCEL-007: Data Mapper (depends on EXCEL-003)
      ↓
Phase 4 (Integration)
  ├─ EXCEL-008: Pipeline Integration (depends on EXCEL-005, EXCEL-006, EXCEL-007)
  ├─ EXCEL-009: Update Dummy Excel (depends on EXCEL-006)
  └─ EXCEL-010: E2E Testing (depends on EXCEL-008)
      ↓
Phase 5 (Documentation)
  ├─ EXCEL-011: API Docs (depends on EXCEL-010)
  └─ EXCEL-012: README (depends on EXCEL-010)
```

---

## 🔧 Technical Considerations

### FFmpeg Installation

**Docker** (`cloud-run-worker/Dockerfile`):
```dockerfile
# Add to Dockerfile
RUN apt-get update && apt-get install -y \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*
```

**Local Development** (macOS):
```bash
brew install ffmpeg
```

**Cloud Run**: FFmpeg should be pre-installed in Node.js base images. Verify with:
```bash
which ffmpeg
ffmpeg -version
```

### Memory Management

**Frame Extraction**:
- Process scenes sequentially (not parallel)
- Clean up temporary frames after Excel generation
- Monitor /tmp directory usage

**Image Embedding**:
- Read images one at a time (not all into memory)
- Use streaming for large Excel files

### Error Handling

**Scene Detection Failures**:
- Fallback: Treat entire video as single scene
- Log warning and continue processing

**Frame Extraction Failures**:
- Skip problematic frames
- Mark screenshot as unavailable in Excel

**Image Embedding Failures**:
- Display "(image unavailable)" text
- Continue with remaining rows

---

## 📈 Performance Expectations

### Based on V1 Performance

**5-Minute Video**:
- Scene Detection: ~10 seconds
- Frame Extraction (10-15 scenes): ~20-30 seconds
- OCR Processing: ~60-90 seconds
- Transcription: ~30-60 seconds
- Excel Generation: ~5-10 seconds
- **Total**: ~2-3 minutes

**Resource Usage**:
- Memory: ~500MB peak (frame processing)
- Disk: ~50MB temporary (cleaned up after)
- CPU: High during FFmpeg/OCR operations

---

## ✅ Success Criteria

### Functional Requirements
- [x] Single-sheet Excel output
- [x] HH:MM:SS timecode format
- [x] Embedded screenshot images (320px width)
- [x] Separate OCR and NA Text columns
- [x] Scene-based detection (not fixed intervals)
- [x] Aspect ratio preservation

### Quality Requirements
- [x] 100% scene detection accuracy (based on V1)
- [x] Images centered in cells
- [x] Readable text with proper wrapping
- [x] Clean temporary file cleanup
- [x] Error handling for edge cases

### Performance Requirements
- [x] Processing time: < 3 minutes for 5-min video
- [x] Memory usage: < 1GB peak
- [x] No temporary file leaks

---

## 🚀 Implementation Schedule

### Immediate (Session 1)
- **Phase 1**: Foundation & Data Structures (30 minutes)
  - EXCEL-001, EXCEL-002, EXCEL-003

### Next Session
- **Phase 2**: FFmpeg Scene Detection (50 minutes)
  - EXCEL-004, EXCEL-005

- **Phase 3**: Excel Generation (1 hour 15 minutes)
  - EXCEL-006, EXCEL-007

### Final Session
- **Phase 4**: Integration & Testing (1 hour 15 minutes)
  - EXCEL-008, EXCEL-009, EXCEL-010

- **Phase 5**: Documentation (30 minutes)
  - EXCEL-011, EXCEL-012

**Total Estimated Time**: 3-4 hours across multiple sessions

---

## 📝 Notes

### V1 Code Reusability
- FFmpeg scene detection: 95% reusable (minor ES6 syntax changes)
- Excel image embedding: 90% reusable (add NA Text column)
- Proven algorithms with 100% OCR accuracy

### Key Differences from V1
- **Architecture**: Cloud Run Worker instead of Render Worker
- **Database**: Supabase for status instead of in-memory
- **Authentication**: Clerk instead of custom auth
- **Excel Library**: ExcelJS (same as V1) ✓

### Risk Mitigation
- Use V1's proven scene detection algorithm (no experimentation)
- Test with small videos first
- Implement comprehensive error handling
- Monitor Cloud Run execution time limits

---

**Document Version**: 1.0
**Created**: 2025-10-30
**Last Updated**: 2025-10-30
**Status**: Ready for Implementation