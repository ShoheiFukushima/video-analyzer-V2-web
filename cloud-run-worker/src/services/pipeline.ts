/**
 * Integrated Video Analysis Pipeline
 * FFmpeg Scene Detection → OCR → Narration Mapping → Excel Generation
 *
 * Implements the ideal workflow for V2:
 * 1. Scene detection with mid-point frame extraction
 * 2. OCR on each scene frame (Gemini Vision)
 * 3. Map narration to scenes based on timestamps
 * 4. Generate Excel with ideal format (Scene # | Timecode | Screenshot | OCR | NA Text)
 */

import { extractScenesWithFrames, getVideoMetadata, cleanupFrames } from './ffmpeg.js';
import { generateExcel, generateExcelFilename } from './excel-generator.js';
import { Scene, ExcelRow, VideoMetadata, ProcessingStats } from '../types/excel.js';
import { formatTimecode } from '../utils/timecode.js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs';
import { promises as fsPromises } from 'fs';
import path from 'path';
import type { TranscriptionSegment } from '../types/shared.js';
import pLimit from 'p-limit';
import { RateLimiter } from './rateLimiter.js';
import { ProgressReporter } from './progressReporter.js';

/**
 * Main pipeline execution
 * @param videoPath - Path to video file
 * @param projectTitle - Project/video title
 * @param transcription - Transcription from whisperService
 * @param uploadId - Optional upload ID for progress tracking
 * @returns Path to generated Excel file
 */
export async function executeIdealPipeline(
  videoPath: string,
  projectTitle: string,
  transcription: TranscriptionSegment[],
  uploadId?: string
): Promise<{ excelPath: string; stats: ProcessingStats }> {
  console.log('🎬 Starting Ideal Pipeline Execution');
  console.log(`  📹 Video: ${videoPath}`);
  console.log(`  🎙️ Transcription: ${transcription.length} segments`);

  // Step 1: Extract video metadata
  console.log('\n📐 Step 1: Extracting video metadata...');
  const videoMetadata = await getVideoMetadata(videoPath);

  // Step 2: Scene detection and frame extraction
  console.log('\n🎞️ Step 2: Scene detection and frame extraction...');
  const scenes = await extractScenesWithFrames(videoPath);
  console.log(`  ✓ Detected ${scenes.length} scenes`);

  // Step 3: Perform OCR on each scene frame
  console.log('\n🔍 Step 3: Performing OCR on scene frames...');
  const scenesWithRawOCR = await performSceneBasedOCR(scenes, uploadId);

  // Step 3.5: Filter out persistent overlays (logos, watermarks)
  console.log('\n🧹 Step 3.5: Filtering persistent overlays...');
  const scenesWithOCR = filterPersistentOverlays(scenesWithRawOCR);

  // Step 4: Map transcription to scenes
  console.log('\n🎙️ Step 4: Mapping transcription to scenes...');
  const scenesWithNarration = mapTranscriptionToScenes(scenesWithOCR, transcription);

  // Step 5: Convert to Excel rows
  console.log('\n📝 Step 5: Converting to Excel rows...');
  const excelRows = convertScenesToExcelRows(scenesWithNarration);

  // Step 6: Generate Excel file
  console.log('\n📊 Step 6: Generating Excel file...');
  const excelFilename = generateExcelFilename(projectTitle);
  const excelPath = path.join('/tmp', excelFilename);

  const excelBuffer = await generateExcel({
    projectTitle,
    rows: excelRows,
    videoMetadata,
    includeStatistics: true
  });

  // Write Excel buffer to file
  await fsPromises.writeFile(excelPath, excelBuffer);

  // Step 7: Calculate statistics
  const stats: ProcessingStats = {
    totalScenes: scenes.length,
    scenesWithOCRText: excelRows.filter(r => r.ocrText && r.ocrText.trim().length > 0).length,
    scenesWithNarration: excelRows.filter(r => r.narrationText && r.narrationText.trim().length > 0).length,
    processingTimeMs: 0, // Set by caller
    videoMetadata
  };

  console.log('\n✅ Ideal Pipeline Execution Complete');
  console.log(`  📊 Excel file: ${excelPath}`);
  console.log(`  📈 Statistics:`, stats);

  // Cleanup frames
  await cleanupFrames(scenes);

  return { excelPath, stats };
}

/**
 * Perform OCR on each scene's frame using Gemini Vision with parallel processing
 * @param scenes - Array of scenes to process
 * @param uploadId - Optional upload ID for progress tracking
 * @returns Array of scenes with OCR results
 */
async function performSceneBasedOCR(scenes: Scene[], uploadId?: string): Promise<SceneWithOCR[]> {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
  // Use latest stable model: gemini-2.5-flash (fast, supports Japanese text)
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

  // Initialize parallel processing components
  const limit = pLimit(3); // Parallel degree of 3
  const rateLimiter = new RateLimiter(15); // 15 requests per minute for Gemini API
  const progressReporter = uploadId ? new ProgressReporter(5) : null; // Report every 5%

  // Progress tracking
  let completedScenes = 0;
  const OCR_PROGRESS_START = 60;
  const OCR_PROGRESS_END = 85;
  const OCR_PROGRESS_RANGE = OCR_PROGRESS_END - OCR_PROGRESS_START;

  console.log(`  🚀 Starting parallel OCR processing (${scenes.length} scenes, parallel degree: 3)`);
  const startTime = Date.now();

  // Process all scenes in parallel with Promise.allSettled
  const results = await Promise.allSettled(
    scenes.map((scene, index) =>
      limit(async () => {
        // Handle scenes without screenshots
        if (!scene.screenshotPath) {
          console.log(`  ⚠️ Scene ${scene.sceneNumber}: No screenshot, skipping OCR`);
          completedScenes++;
          return {
            ...scene,
            ocrText: '',
            ocrConfidence: 0
          };
        }

        try {
          // Apply rate limiting
          await rateLimiter.acquire();

          // Read screenshot file
          const imageBuffer = fs.readFileSync(scene.screenshotPath);
          const base64Image = imageBuffer.toString('base64');

          // Gemini Vision OCR prompt
          const prompt = `Analyze this video frame and extract ALL visible text.

Please provide a JSON response with this structure:
{
  "text": "all extracted text concatenated",
  "confidence": 0.95
}

Focus on:
- Japanese text (kanji, hiragana, katakana)
- English text
- Numbers and symbols
- Screen overlays, titles, captions

Return empty string if no text detected.`;

          // Call Gemini Vision API
          const result = await model.generateContent([
            prompt,
            { inlineData: { mimeType: 'image/png', data: base64Image } }
          ]);

          const responseText = result.response.text();

          // Parse JSON response
          let ocrResult: { text: string; confidence: number };
          try {
            // Remove markdown code blocks if present
            const jsonText = responseText.replace(/```json\n?|\n?```/g, '').trim();
            ocrResult = JSON.parse(jsonText);
          } catch {
            // Fallback: use raw text
            ocrResult = { text: responseText, confidence: 0.5 };
          }

          completedScenes++;

          // Report progress if reporter is available
          if (progressReporter && uploadId) {
            const progress = Math.floor(
              OCR_PROGRESS_START + (completedScenes / scenes.length) * OCR_PROGRESS_RANGE
            );
            await progressReporter.report(
              uploadId,
              progress,
              'ocr_processing',
              `OCR: ${completedScenes}/${scenes.length} scenes completed`
            );
          }

          console.log(
            `  ✓ Scene ${scene.sceneNumber}: OCR complete (${ocrResult.text.length} chars) ` +
            `[${completedScenes}/${scenes.length}]`
          );

          return {
            ...scene,
            ocrText: ocrResult.text || '',
            ocrConfidence: ocrResult.confidence || 0
          };

        } catch (error) {
          console.error(`  ✗ Scene ${scene.sceneNumber}: OCR failed`);
          if (error instanceof Error) {
            console.error(`    Error: ${error.message}`);
          }
          completedScenes++;

          // Return empty result on error
          return {
            ...scene,
            ocrText: '',
            ocrConfidence: 0
          };
        }
      })
    )
  );

  // Calculate and log performance metrics
  const duration = (Date.now() - startTime) / 1000;
  console.log(`  ✓ Parallel OCR completed in ${duration.toFixed(2)}s`);
  console.log(`  📊 Average: ${(duration / scenes.length).toFixed(2)}s per scene`);

  // Convert Promise.allSettled results to SceneWithOCR array
  const scenesWithOCR: SceneWithOCR[] = results.map((result, index) => {
    if (result.status === 'fulfilled') {
      return result.value;
    } else {
      console.error(`  Scene ${scenes[index].sceneNumber} promise rejected:`, result.reason);
      return {
        ...scenes[index],
        ocrText: '',
        ocrConfidence: 0
      };
    }
  });

  // Final progress report
  if (progressReporter && uploadId) {
    await progressReporter.forceReport(uploadId, OCR_PROGRESS_END, 'ocr_completed', 'OCR processing completed');
  }

  console.log(`  ✓ OCR complete: ${scenesWithOCR.filter(s => s.ocrText).length}/${scenes.length} scenes with text`);
  return scenesWithOCR;
}

/**
 * Filter out persistent overlays (logos, watermarks, constant UI elements)
 * Removes text that appears in 50% or more of scenes
 *
 * @param scenesWithOCR - Scenes with OCR text
 * @param options - Filter options (threshold, minScenes)
 * @returns Filtered scenes
 */
interface OverlayFilterOptions {
  threshold?: number; // Default: 0.5 (50%)
  minScenes?: number; // Default: 3 (minimum scenes to apply filter)
}

function filterPersistentOverlays(
  scenesWithOCR: SceneWithOCR[],
  options: OverlayFilterOptions = {}
): SceneWithOCR[] {
  const { threshold = 0.5, minScenes = 3 } = options;

  // Early return for empty array
  if (scenesWithOCR.length === 0) return scenesWithOCR;

  // Skip filtering for very small scene counts (insufficient data for statistical analysis)
  if (scenesWithOCR.length < minScenes) {
    console.log(`  ⚠️ Only ${scenesWithOCR.length} scenes detected. Skipping persistent overlay filter (minimum: ${minScenes} scenes required).`);
    return scenesWithOCR;
  }

  // Log filter configuration
  console.log(`  🔧 Filter config: threshold=${(threshold * 100).toFixed(0)}%, minScenes=${minScenes}`);

  // Step 1: Split each scene's OCR text into lines
  const allLines: string[][] = scenesWithOCR.map(scene =>
    scene.ocrText
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
  );

  // Step 2: Count how many scenes each unique line appears in
  const lineFrequency = new Map<string, number>();
  const totalScenes = scenesWithOCR.length;

  for (const lines of allLines) {
    const uniqueLines = new Set(lines); // Count each line once per scene
    for (const line of uniqueLines) {
      lineFrequency.set(line, (lineFrequency.get(line) || 0) + 1);
    }
  }

  // Step 3: Identify persistent lines (appear in >= threshold% of scenes)
  // Use float comparison for accurate threshold calculation
  const persistentThreshold = totalScenes * threshold;
  const persistentLines = new Set<string>();

  for (const [line, count] of lineFrequency.entries()) {
    if (count >= persistentThreshold) {
      persistentLines.add(line);
    }
  }

  // Debug: Log all unique lines and their frequencies
  console.log(`  🔍 Debug: Analyzing ${lineFrequency.size} unique lines`);
  const sortedLines = Array.from(lineFrequency.entries()).sort((a, b) => b[1] - a[1]);
  console.log(`  📊 Top 10 most frequent lines:`);
  for (const [line, count] of sortedLines.slice(0, 10)) {
    const percentage = ((count / totalScenes) * 100).toFixed(0);
    console.log(`    [${count}/${totalScenes} = ${percentage}%] "${line.substring(0, 60)}${line.length > 60 ? '...' : ''}"`);
  }

  console.log(`  ✓ Detected ${persistentLines.size} persistent overlay lines (threshold: ≥${(threshold * 100).toFixed(0)}% of ${totalScenes} scenes)`);
  if (persistentLines.size > 0) {
    console.log(`  📌 Persistent lines:`);
    for (const line of persistentLines) {
      const count = lineFrequency.get(line) || 0;
      const percentage = ((count / totalScenes) * 100).toFixed(0);
      console.log(`    - "${line.substring(0, 50)}${line.length > 50 ? '...' : ''}" (${count}/${totalScenes} = ${percentage}%)`);
    }
  }

  // Step 4: Remove persistent lines from each scene
  const filteredScenes = scenesWithOCR.map(scene => {
    const lines = scene.ocrText
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0 && !persistentLines.has(line));

    const filteredText = lines.join('\n');

    return {
      ...scene,
      ocrText: filteredText
    };
  });

  const scenesWithTextBefore = scenesWithOCR.filter(s => s.ocrText.trim().length > 0).length;
  const scenesWithTextAfter = filteredScenes.filter(s => s.ocrText.trim().length > 0).length;

  console.log(`  ✓ Filtered: ${scenesWithTextBefore} → ${scenesWithTextAfter} scenes with unique text`);

  return filteredScenes;
}

/**
 * Map transcription segments to scenes based on timestamps
 * Aggregates all transcription text that overlaps with each scene
 */
function mapTranscriptionToScenes(
  scenesWithOCR: SceneWithOCR[],
  transcription: TranscriptionSegment[]
): SceneWithNarration[] {
  return scenesWithOCR.map(scene => {
    // Find all transcription segments that overlap with this scene
    const overlappingSegments = transcription.filter(seg => {
      const segStart = seg.timestamp;
      const segEnd = seg.timestamp + seg.duration;
      const sceneStart = scene.startTime;
      const sceneEnd = scene.endTime;

      // Check if there's any overlap
      return segStart < sceneEnd && segEnd > sceneStart;
    });

    // Concatenate all overlapping transcription text
    const narrationText = overlappingSegments
      .map(seg => seg.text.trim())
      .filter(text => text.length > 0)
      .join(' ');

    return {
      ...scene,
      narrationText
    };
  });
}

/**
 * Convert scenes to Excel rows
 */
function convertScenesToExcelRows(scenes: SceneWithNarration[]): ExcelRow[] {
  return scenes.map(scene => ({
    sceneNumber: scene.sceneNumber,
    timecode: scene.timecode,
    screenshotPath: scene.screenshotPath!,
    ocrText: scene.ocrText || '',
    narrationText: scene.narrationText || ''
  }));
}

/**
 * Extended Scene interface with OCR
 */
interface SceneWithOCR extends Scene {
  ocrText: string;
  ocrConfidence: number;
}

/**
 * Extended Scene interface with OCR and narration
 */
interface SceneWithNarration extends SceneWithOCR {
  narrationText: string;
}
