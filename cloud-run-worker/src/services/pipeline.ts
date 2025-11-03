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

/**
 * Transcription segment (from Whisper pipeline)
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
 * @param transcription - Transcription from whisperService
 * @returns Path to generated Excel file
 */
export async function executeIdealPipeline(
  videoPath: string,
  projectTitle: string,
  transcription: TranscriptionSegment[]
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
  const scenesWithRawOCR = await performSceneBasedOCR(scenes);

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
 * Perform OCR on each scene's frame using Gemini Vision
 */
async function performSceneBasedOCR(scenes: Scene[]): Promise<SceneWithOCR[]> {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
  // Use latest stable model: gemini-2.5-flash (fast, supports Japanese text)
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

  const scenesWithOCR: SceneWithOCR[] = [];

  for (const scene of scenes) {
    if (!scene.screenshotPath) {
      console.log(`  ⚠️ Scene ${scene.sceneNumber}: No screenshot, skipping OCR`);
      scenesWithOCR.push({
        ...scene,
        ocrText: '',
        ocrConfidence: 0
      });
      continue;
    }

    try {
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

      scenesWithOCR.push({
        ...scene,
        ocrText: ocrResult.text || '',
        ocrConfidence: ocrResult.confidence || 0
      });

      console.log(`  ✓ Scene ${scene.sceneNumber}: OCR complete (${ocrResult.text.length} chars)`);

    } catch (error) {
      console.error(`  ✗ Scene ${scene.sceneNumber}: OCR failed`);
      if (error instanceof Error) {
        console.error(`    Error: ${error.message}`);
        console.error(`    Stack: ${error.stack?.split('\n')[0]}`);
      } else {
        console.error(`    Error:`, error);
      }
      scenesWithOCR.push({
        ...scene,
        ocrText: '',
        ocrConfidence: 0
      });
    }
  }

  console.log(`  ✓ OCR complete: ${scenesWithOCR.filter(s => s.ocrText).length}/${scenes.length} scenes with text`);
  return scenesWithOCR;
}

/**
 * Filter out persistent overlays (logos, watermarks, constant UI elements)
 * Removes text that appears in 50% or more of scenes using substring matching
 */
function filterPersistentOverlays(scenesWithOCR: SceneWithOCR[]): SceneWithOCR[] {
  if (scenesWithOCR.length === 0) return scenesWithOCR;

  const totalScenes = scenesWithOCR.length;
  const persistentThreshold = Math.ceil(totalScenes * 0.5);

  console.log(`  🔍 Analyzing ${totalScenes} scenes for persistent overlays (threshold: ${persistentThreshold}/${totalScenes} scenes, ≥50%)`);

  // Step 1: Extract candidate phrases (substrings) from all scenes
  const candidatePhrases = new Set<string>();
  const minPhraseLength = 8; // Minimum 8 characters to be considered
  const maxPhraseLength = 100; // Maximum 100 characters
  const maxCandidates = 5000; // Performance limit

  for (const scene of scenesWithOCR) {
    const text = scene.ocrText.trim();
    if (text.length === 0) continue;

    // Extract all substrings between minPhraseLength and maxPhraseLength
    for (let len = minPhraseLength; len <= Math.min(maxPhraseLength, text.length); len++) {
      for (let i = 0; i <= text.length - len; i++) {
        const phrase = text.substring(i, i + len).trim();

        // Only add meaningful phrases (not just spaces or symbols)
        if (phrase.length >= minPhraseLength && !/^\s*$/.test(phrase)) {
          candidatePhrases.add(phrase);
        }

        // Performance safeguard
        if (candidatePhrases.size >= maxCandidates) break;
      }
      if (candidatePhrases.size >= maxCandidates) break;
    }
  }

  console.log(`  📊 Extracted ${candidatePhrases.size} candidate phrases`);

  // Step 2: Count how many scenes each phrase appears in (substring match)
  const phraseFrequency = new Map<string, number>();

  for (const phrase of candidatePhrases) {
    let count = 0;
    for (const scene of scenesWithOCR) {
      if (scene.ocrText.includes(phrase)) {  // ← KEY CHANGE: substring match instead of exact match
        count++;
      }
    }

    // Only track phrases that appear in multiple scenes
    if (count >= 2) {
      phraseFrequency.set(phrase, count);
    }
  }

  console.log(`  📈 Found ${phraseFrequency.size} phrases appearing in multiple scenes`);

  // Step 3: Identify persistent phrases (appear in >= 50% of scenes)
  const persistentPhrases = Array.from(phraseFrequency.entries())
    .filter(([_, count]) => count >= persistentThreshold)
    .sort((a, b) => {
      // Sort by length (longer first) then by frequency
      if (b[0].length !== a[0].length) {
        return b[0].length - a[0].length;
      }
      return b[1] - a[1];
    })
    .map(([phrase, _]) => phrase);

  // Remove redundant phrases (if a longer phrase contains a shorter one)
  const deduplicatedPhrases: string[] = [];
  for (const phrase of persistentPhrases) {
    const isSubstring = deduplicatedPhrases.some(longer =>
      longer.length > phrase.length && longer.includes(phrase)
    );
    if (!isSubstring) {
      deduplicatedPhrases.push(phrase);
    }
  }

  console.log(`  ✓ Detected ${deduplicatedPhrases.length} persistent overlay phrases (after deduplication)`);

  if (deduplicatedPhrases.length > 0) {
    console.log(`  📌 Persistent phrases:`);
    for (const phrase of deduplicatedPhrases.slice(0, 10)) { // Show top 10
      const count = phraseFrequency.get(phrase) || 0;
      const percentage = ((count / totalScenes) * 100).toFixed(0);
      console.log(`    [${count}/${totalScenes} = ${percentage}%] "${phrase.substring(0, 50)}${phrase.length > 50 ? '...' : ''}"`);
    }
    if (deduplicatedPhrases.length > 10) {
      console.log(`    ... and ${deduplicatedPhrases.length - 10} more`);
    }
  }

  // Step 4: Remove persistent phrases from each scene
  const filteredScenes = scenesWithOCR.map(scene => {
    let filteredText = scene.ocrText;

    // Remove each persistent phrase
    for (const phrase of deduplicatedPhrases) {
      filteredText = filteredText.split(phrase).join(''); // Remove all occurrences
    }

    // Clean up extra whitespace
    filteredText = filteredText
      .replace(/\s+/g, ' ') // Multiple spaces to single space
      .trim();

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
