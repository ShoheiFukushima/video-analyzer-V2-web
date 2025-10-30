/**
 * Integrated Video Analysis Pipeline
 * FFmpeg Scene Detection → OCR → Narration Mapping → Excel Generation
 *
 * Implements the ideal workflow for V2:
 * 1. Scene detection with mid-point frame extraction
 * 2. OCR on each scene frame
 * 3. Map narration to scenes based on timestamps
 * 4. Generate Excel with ideal format (Scene # | Timecode | Screenshot | OCR | NA Text)
 */

import { extractScenesWithFrames, getVideoMetadata, cleanupFrames } from './ffmpeg.js';
import { generateExcel, generateExcelFilename } from './excel-generator.js';
import { Scene, ExcelRow, VideoMetadata, ProcessingStats } from '../types/excel.js';
import { formatTimecode } from '../utils/timecode.js';
import path from 'path';

/**
 * OCR service result (from existing ocrService.ts)
 */
interface OCRResult {
  timestamp: number;
  frameIndex: number;
  text: string;
  confidence: number;
}

/**
 * Transcription segment (from existing whisperService.ts)
 */
interface TranscriptionSegment {
  timestamp: number;
  duration: number;
  text: string;
  confidence: number;
}

/**
 * Main pipeline execution
 * @param videoPath - Path to video file
 * @param projectTitle - Project/video title
 * @param ocrResults - OCR results from ocrService
 * @param transcription - Transcription from whisperService
 * @returns Path to generated Excel file
 */
export async function executeIdealPipeline(
  videoPath: string,
  projectTitle: string,
  ocrResults: OCRResult[],
  transcription: TranscriptionSegment[]
): Promise<{ excelPath: string; stats: ProcessingStats }> {
  console.log('🎬 Starting Ideal Pipeline Execution');
  console.log(`  📹 Video: ${videoPath}`);
  console.log(`  📊 OCR Results: ${ocrResults.length} frames`);
  console.log(`  🎙️ Transcription: ${transcription.length} segments`);

  // Step 1: Extract video metadata
  console.log('\n📐 Step 1: Extracting video metadata...');
  const videoMetadata = await getVideoMetadata(videoPath);

  // Step 2: Scene detection and frame extraction
  console.log('\n🎞️ Step 2: Scene detection and frame extraction...');
  const scenes = await extractScenesWithFrames(videoPath);
  console.log(`  ✓ Detected ${scenes.length} scenes`);

  // Step 3: Map OCR results to scenes
  console.log('\n🔍 Step 3: Mapping OCR results to scenes...');
  const scenesWithOCR = mapOCRToScenes(scenes, ocrResults);

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

  await generateExcel({
    projectTitle,
    rows: excelRows,
    videoMetadata,
    includeStatistics: true
  });

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
 * Map OCR results to scenes based on timestamps
 * Finds the closest OCR result for each scene's frame timestamp
 */
function mapOCRToScenes(scenes: Scene[], ocrResults: OCRResult[]): SceneWithOCR[] {
  return scenes.map(scene => {
    // Find OCR result closest to scene's mid-point timestamp
    const closestOCR = findClosestOCR(scene.midTime, ocrResults);

    return {
      ...scene,
      ocrText: closestOCR?.text || '',
      ocrConfidence: closestOCR?.confidence || 0
    };
  });
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
 * Find OCR result closest to target timestamp
 */
function findClosestOCR(targetTime: number, ocrResults: OCRResult[]): OCRResult | undefined {
  if (ocrResults.length === 0) return undefined;

  let closest = ocrResults[0];
  let minDiff = Math.abs(targetTime - closest.timestamp);

  for (const ocr of ocrResults) {
    const diff = Math.abs(targetTime - ocr.timestamp);
    if (diff < minDiff) {
      minDiff = diff;
      closest = ocr;
    }
  }

  return closest;
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
