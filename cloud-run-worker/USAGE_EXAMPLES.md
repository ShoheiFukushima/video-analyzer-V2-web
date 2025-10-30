# Usage Examples - Ideal Excel Pipeline

This document provides practical examples for using the ideal Excel output pipeline.

## Table of Contents

1. [Quick Start](#quick-start)
2. [Basic Usage](#basic-usage)
3. [Advanced Usage](#advanced-usage)
4. [Integration Examples](#integration-examples)
5. [Troubleshooting](#troubleshooting)

---

## Quick Start

### E2E Test with Mock Data

The fastest way to see the pipeline in action:

```bash
cd cloud-run-worker

# Build TypeScript
npm run build

# Run E2E test with a sample video
node dist/test-ideal-pipeline.js /path/to/test-video.mp4
```

**Output:**
```
🧪 E2E Test: Ideal Excel Output Pipeline

📹 Video file: /path/to/test-video.mp4

🎭 Generating mock OCR and transcription data...
  ✓ Mock OCR: 10 results
  ✓ Mock Transcription: 6 segments

🎬 Starting Ideal Pipeline Execution
  📹 Video: /path/to/test-video.mp4

📐 Step 1: Extracting video metadata...
📹 Video Metadata: 1920x1080 (1.78:1), 120s

🎞️ Step 2: Scene detection and frame extraction...
🔍 Starting multi-pass scene detection...
  ✓ Detected 15 scenes

📝 Step 5: Converting to Excel rows...
📊 Step 6: Generating Excel file...

✅ Test Complete!

📊 Results:
  Excel file: /tmp/test-video_2025-10-30T12-34-56.xlsx
  Processing time: 45.23s

📈 Statistics:
  Total scenes: 15
  Scenes with OCR text: 10
  Scenes with narration: 14
  OCR coverage: 66.7%
  Narration coverage: 93.3%
```

---

## Basic Usage

### 1. Using the Pipeline Service Directly

```typescript
import { executeIdealPipeline } from './services/pipeline.js';

// Example OCR results (from your OCR service)
const ocrResults = [
  {
    timestamp: 5.2,
    frameIndex: 0,
    text: "Welcome to the presentation",
    confidence: 0.95
  },
  {
    timestamp: 15.8,
    frameIndex: 1,
    text: "Slide 2: Key Points",
    confidence: 0.92
  }
];

// Example transcription (from your Whisper service)
const transcription = [
  {
    timestamp: 0,
    duration: 10.5,
    text: "Hello everyone, today we'll discuss...",
    confidence: 0.94
  },
  {
    timestamp: 10.5,
    duration: 8.2,
    text: "Let's start with the first topic.",
    confidence: 0.91
  }
];

// Execute pipeline
const result = await executeIdealPipeline(
  '/path/to/video.mp4',
  'My Project',
  ocrResults,
  transcription
);

console.log('Excel file:', result.excelPath);
console.log('Statistics:', result.stats);
```

### 2. Scene Detection Only

```typescript
import { extractScenesWithFrames, cleanupFrames } from './services/ffmpeg.js';

// Extract scenes and frames
const scenes = await extractScenesWithFrames('/path/to/video.mp4');

console.log(`Detected ${scenes.length} scenes`);

scenes.forEach(scene => {
  console.log(`Scene ${scene.sceneNumber}: ${scene.timecode}`);
  console.log(`  Range: ${scene.startTime}s - ${scene.endTime}s`);
  console.log(`  Mid-point: ${scene.midTime}s`);
  console.log(`  Screenshot: ${scene.screenshotPath}`);
});

// Cleanup when done
await cleanupFrames(scenes);
```

### 3. Excel Generation Only

```typescript
import { generateExcel } from './services/excel-generator.js';
import type { ExcelRow, VideoMetadata } from './types/excel.js';

// Prepare Excel rows
const rows: ExcelRow[] = [
  {
    sceneNumber: 1,
    timecode: '00:00:05',
    screenshotPath: '/tmp/frame-0001.png',
    ocrText: 'Title Slide',
    narrationText: 'Welcome to the presentation'
  },
  {
    sceneNumber: 2,
    timecode: '00:00:15',
    screenshotPath: '/tmp/frame-0002.png',
    ocrText: 'Agenda',
    narrationText: 'Today we will cover three main topics'
  }
];

// Video metadata
const videoMetadata: VideoMetadata = {
  width: 1920,
  height: 1080,
  aspectRatio: 1.78,
  duration: 120
};

// Generate Excel
await generateExcel({
  projectTitle: 'My Video Analysis',
  rows,
  videoMetadata,
  includeStatistics: true
});
```

---

## Advanced Usage

### Custom Scene Detection Configuration

```typescript
import { extractScenesWithFrames } from './services/ffmpeg.js';

// Default configuration
const scenes = await extractScenesWithFrames(
  '/path/to/video.mp4',
  '/custom/output/dir' // Optional custom output directory
);

// The service uses these defaults internally:
// - thresholds: [0.03, 0.05, 0.10]
// - minSceneDuration: 0.5 seconds
```

### Handling Large Videos

```typescript
import { executeIdealPipeline } from './services/pipeline.js';

// For large videos, process in batches
async function processLargeVideo(videoPath: string) {
  try {
    const startTime = Date.now();

    // Execute pipeline with timeout handling
    const result = await Promise.race([
      executeIdealPipeline(videoPath, 'Large Video', ocrResults, transcription),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Timeout')), 600000) // 10 min timeout
      )
    ]);

    const processingTime = Date.now() - startTime;
    console.log(`Processing completed in ${processingTime}ms`);

    return result;
  } catch (error) {
    console.error('Processing failed:', error);
    throw error;
  }
}
```

### Custom Statistics Calculation

```typescript
import type { ExcelRow, ProcessingStats } from './types/excel.js';

function calculateCustomStats(rows: ExcelRow[]): ProcessingStats {
  const totalScenes = rows.length;
  const scenesWithOCR = rows.filter(r => r.ocrText.trim().length > 0).length;
  const scenesWithNarration = rows.filter(r => r.narrationText.trim().length > 0).length;

  // Custom metrics
  const averageOCRLength = rows.reduce((sum, r) => sum + r.ocrText.length, 0) / totalScenes;
  const averageNarrationLength = rows.reduce((sum, r) => sum + r.narrationText.length, 0) / totalScenes;

  return {
    totalScenes,
    scenesWithOCRText: scenesWithOCR,
    scenesWithNarration: scenesWithNarration,
    processingTimeMs: 0,
    // Add custom fields
    estimatedCost: totalScenes * 0.000075, // Gemini Vision cost
    videoMetadata: {
      width: 1920,
      height: 1080,
      aspectRatio: 1.78,
      duration: totalScenes * 10 // Estimated
    }
  };
}
```

---

## Integration Examples

### Integrating with Existing videoProcessor.ts

```typescript
import { executeIdealPipeline } from './services/pipeline.js';
import { transcribeAudio } from './whisperService.js';
import { extractFramesAndOCR } from './ocrService.js';

export const processVideo = async (
  uploadId: string,
  blobUrl: string,
  fileName: string
) => {
  try {
    const videoPath = '/tmp/video.mp4';

    // Download video...
    // Extract audio...

    // Step 1: Transcribe with Whisper
    const transcription = await transcribeAudio(audioPath, uploadId);

    // Step 2: Perform OCR
    const ocrResults = await extractFramesAndOCR(videoPath, uploadId);

    // Step 3: Execute ideal pipeline
    const { excelPath, stats } = await executeIdealPipeline(
      videoPath,
      fileName,
      ocrResults,
      transcription
    );

    console.log('Pipeline complete:', stats);

    // Upload Excel to blob storage...
    // Update status...

    return excelPath;
  } catch (error) {
    console.error('Processing failed:', error);
    throw error;
  }
};
```

### Progress Tracking

```typescript
import { extractScenesWithFrames } from './services/ffmpeg.js';

async function processWithProgress(
  videoPath: string,
  onProgress: (stage: string, percent: number) => void
) {
  try {
    onProgress('scene_detection', 0);

    const scenes = await extractScenesWithFrames(videoPath);

    onProgress('scene_detection', 100);
    onProgress('ocr_processing', 0);

    // Process OCR for each scene
    for (let i = 0; i < scenes.length; i++) {
      // ... perform OCR ...
      onProgress('ocr_processing', ((i + 1) / scenes.length) * 100);
    }

    onProgress('excel_generation', 0);
    // ... generate Excel ...
    onProgress('excel_generation', 100);

    onProgress('completed', 100);
  } catch (error) {
    onProgress('error', 0);
    throw error;
  }
}
```

---

## Troubleshooting

### Common Issues

#### 1. No Scenes Detected

**Symptom:**
```
⚠️ No scene cuts detected, falling back to single scene
```

**Cause:** Video has very few scene changes or is static content.

**Solution:**
- This is expected behavior for videos with minimal scene changes
- The pipeline will treat the entire video as one scene
- You can manually adjust scene detection thresholds if needed

#### 2. Screenshot Extraction Fails

**Symptom:**
```
⚠️ Failed to embed screenshot for Scene 5: ENOENT: no such file or directory
```

**Cause:** Frame file was deleted or path is incorrect.

**Solution:**
- Ensure temporary directory has write permissions
- Check disk space availability
- Verify FFmpeg is installed and accessible

#### 3. Memory Issues with Large Videos

**Symptom:**
```
Error: JavaScript heap out of memory
```

**Solution:**
```bash
# Increase Node.js memory limit
node --max-old-space-size=4096 dist/test-ideal-pipeline.js video.mp4
```

#### 4. Excel File Corruption

**Symptom:** Excel file won't open or displays errors.

**Cause:** Image embedding failed or file write interrupted.

**Solution:**
- Check that all screenshot paths are valid before Excel generation
- Ensure sufficient disk space
- Verify ExcelJS version compatibility

### Performance Optimization

```typescript
// For better performance with large videos:

// 1. Process scenes in parallel (if memory allows)
const scenePromises = scenes.map(async (scene) => {
  const ocr = await performOCR(scene.screenshotPath);
  return { ...scene, ocrText: ocr.text };
});
const processedScenes = await Promise.all(scenePromises);

// 2. Use streaming for large Excel files
import { Workbook } from 'exceljs';
const workbook = new Workbook();
const worksheet = workbook.addWorksheet('Video Analysis');
// ... add data in batches ...
await workbook.xlsx.writeFile(excelPath);

// 3. Clean up resources immediately
await cleanupFrames(scenes);
```

### Debug Mode

```typescript
// Enable verbose logging
const DEBUG = process.env.DEBUG === 'true';

if (DEBUG) {
  console.log('Scene detection config:', {
    thresholds: [0.03, 0.05, 0.10],
    minSceneDuration: 0.5
  });

  console.log('OCR results:', ocrResults.length);
  console.log('Transcription segments:', transcription.length);
}
```

---

## Additional Resources

- **API Documentation:** See [`API_DOCUMENTATION.md`](../API_DOCUMENTATION.md)
- **Implementation Plan:** See [`EXCEL_OUTPUT_IMPLEMENTATION_PLAN.md`](../EXCEL_OUTPUT_IMPLEMENTATION_PLAN.md)
- **Deployment Guide:** See [`DEPLOYMENT_GUIDE.md`](../DEPLOYMENT_GUIDE.md)

---

## Support

For issues or questions:
- Create an issue in the project repository
- Check existing documentation
- Review test examples in `test-ideal-pipeline.ts`
