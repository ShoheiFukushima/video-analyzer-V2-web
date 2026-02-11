/**
 * Multi-Frame OCR Service
 *
 * Extracts and analyzes multiple frames per scene to:
 * - Catch text that appears via animation/fade
 * - Find the best frame for OCR
 * - Detect text appearance timing
 *
 * Used in Enhanced mode for standard scenes (not just stabilization points)
 *
 * @module multiFrameOCR
 */

import ffmpeg from 'fluent-ffmpeg';
import { promises as fs } from 'fs';
import path from 'path';
import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';
import { SimpleRateLimiter } from './rateLimiter.js';
import pLimit from 'p-limit';
import type { Scene } from '../types/excel.js';

// ========================================
// Types
// ========================================

export interface MultiFrameConfig {
  /** Frame positions within scene (default: [0.25, 0.5, 0.75]) */
  positions: number[];
  /** Frame selection strategy */
  strategy: 'first_stable' | 'most_text' | 'highest_confidence';
}

export interface FrameOCRResult {
  /** Position within scene (0-1) */
  position: number;
  /** Absolute timestamp in seconds */
  timestamp: number;
  /** Path to extracted frame */
  path: string;
  /** Extracted text */
  text: string;
  /** OCR confidence (0-1) */
  confidence: number;
}

export interface MultiFrameOCRResult {
  /** Best frame selected by strategy */
  bestFrame: FrameOCRResult;
  /** All frame results */
  allFrames: FrameOCRResult[];
  /** Position where text first appears (if detected) */
  textAppearancePosition?: number;
  /** Position where text stabilizes (if detected) */
  textStabilityPosition?: number;
}

export interface SceneWithMultiFrameOCR extends Scene {
  ocrText: string;
  ocrConfidence: number;
  textAppearancePosition?: number;
  textStabilityPosition?: number;
}

// ========================================
// Constants
// ========================================

const DEFAULT_CONFIG: MultiFrameConfig = {
  positions: [0.25, 0.5, 0.75],
  strategy: 'first_stable'
};

// ========================================
// Frame Extraction
// ========================================

/**
 * Extract multiple frames from a scene at specified positions
 *
 * @param videoPath - Path to video file
 * @param scene - Scene to extract frames from
 * @param outputDir - Directory to save frames
 * @param config - Configuration options
 * @returns Array of extracted frame paths with timestamps
 */
export async function extractMultipleFrames(
  videoPath: string,
  scene: Scene,
  outputDir: string,
  config: Partial<MultiFrameConfig> = {}
): Promise<{ position: number; timestamp: number; path: string }[]> {
  const fullConfig = { ...DEFAULT_CONFIG, ...config };
  const frames: { position: number; timestamp: number; path: string }[] = [];

  const duration = scene.endTime - scene.startTime;

  for (const position of fullConfig.positions) {
    const timestamp = scene.startTime + (duration * position);
    const framePath = path.join(
      outputDir,
      `scene-${scene.sceneNumber.toString().padStart(4, '0')}-p${(position * 100).toFixed(0)}.png`
    );

    await extractSingleFrame(videoPath, timestamp, framePath);

    frames.push({
      position,
      timestamp,
      path: framePath
    });
  }

  return frames;
}

/**
 * Extract a single frame at a specific timestamp
 */
function extractSingleFrame(
  videoPath: string,
  timestamp: number,
  outputPath: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .seekInput(timestamp)
      .frames(1)
      .outputOptions(['-vf', 'unsharp=5:5:1.0:5:5:0.0', '-pix_fmt', 'rgb24'])
      .output(outputPath)
      .on('end', () => resolve())
      .on('error', reject)
      .run();
  });
}

// ========================================
// OCR Processing
// ========================================

/**
 * Perform OCR on a single frame
 *
 * @param frame - Frame info
 * @param model - Gemini model
 * @returns OCR result
 */
async function performSingleFrameOCR(
  frame: { position: number; timestamp: number; path: string },
  model: GenerativeModel
): Promise<FrameOCRResult> {
  try {
    const imageBuffer = await fs.readFile(frame.path);
    const base64Image = imageBuffer.toString('base64');

    // Simplified prompt for multi-frame OCR
    const prompt = `Extract visible text from this video frame. Return JSON only:
{"text": "extracted text", "confidence": 0.95}
Focus on subtitles and main titles. Return empty text if no visible text.`;

    const result = await model.generateContent([
      prompt,
      { inlineData: { mimeType: 'image/png', data: base64Image } }
    ]);

    const responseText = result.response.text();
    const jsonText = responseText.replace(/```json\n?|\n?```/g, '').trim();

    try {
      const parsed = JSON.parse(jsonText);
      return {
        position: frame.position,
        timestamp: frame.timestamp,
        path: frame.path,
        text: parsed.text || '',
        confidence: parsed.confidence || 0
      };
    } catch {
      return {
        position: frame.position,
        timestamp: frame.timestamp,
        path: frame.path,
        text: '',
        confidence: 0
      };
    }
  } catch (error) {
    console.warn(`  Multi-frame OCR error at position ${frame.position}:`, error);
    return {
      position: frame.position,
      timestamp: frame.timestamp,
      path: frame.path,
      text: '',
      confidence: 0
    };
  }
}

/**
 * Perform OCR on multiple frames and select the best result
 *
 * @param scene - Scene being processed
 * @param frames - Extracted frames
 * @param model - Gemini model
 * @param rateLimiter - Rate limiter
 * @param config - Configuration
 * @returns Multi-frame OCR result
 */
export async function performMultiFrameOCR(
  scene: Scene,
  frames: { position: number; timestamp: number; path: string }[],
  model: GenerativeModel,
  rateLimiter: SimpleRateLimiter,
  config: Partial<MultiFrameConfig> = {}
): Promise<MultiFrameOCRResult> {
  const fullConfig = { ...DEFAULT_CONFIG, ...config };
  const limit = pLimit(3); // Parallel limit for frames within a scene

  // Process all frames in parallel (within rate limits)
  const results = await Promise.all(
    frames.map(frame =>
      limit(async () => {
        await rateLimiter.acquire();
        return performSingleFrameOCR(frame, model);
      })
    )
  );

  // Sort by position for analysis
  const sortedResults = results.sort((a, b) => a.position - b.position);

  // Select best frame based on strategy
  const bestFrame = selectBestFrame(sortedResults, fullConfig.strategy);

  // Detect text appearance
  const textAppearancePosition = findTextAppearancePosition(sortedResults);
  const textStabilityPosition = findTextStabilityPosition(sortedResults);

  return {
    bestFrame,
    allFrames: sortedResults,
    textAppearancePosition,
    textStabilityPosition
  };
}

// ========================================
// Frame Selection Strategies
// ========================================

/**
 * Select the best frame based on strategy
 */
function selectBestFrame(
  results: FrameOCRResult[],
  strategy: MultiFrameConfig['strategy']
): FrameOCRResult {
  if (results.length === 0) {
    throw new Error('No frames to select from');
  }

  switch (strategy) {
    case 'first_stable':
      return selectFirstStableFrame(results);
    case 'most_text':
      return selectMostTextFrame(results);
    case 'highest_confidence':
      return selectHighestConfidenceFrame(results);
    default:
      return results[Math.floor(results.length / 2)]; // Default to middle
  }
}

/**
 * Select first frame where text appears and is stable
 */
function selectFirstStableFrame(results: FrameOCRResult[]): FrameOCRResult {
  const normalizeText = (text: string): string =>
    text.trim().toLowerCase().replace(/\s+/g, ' ');

  for (let i = 0; i < results.length - 1; i++) {
    const current = results[i];
    const next = results[i + 1];

    const currentNorm = normalizeText(current.text);
    const nextNorm = normalizeText(next.text);

    // If current has text and matches next, it's stable
    if (currentNorm.length > 0 && currentNorm === nextNorm) {
      return current;
    }
  }

  // Fallback to most text
  return selectMostTextFrame(results);
}

/**
 * Select frame with most text content
 */
function selectMostTextFrame(results: FrameOCRResult[]): FrameOCRResult {
  return results.reduce((best, current) =>
    current.text.length > best.text.length ? current : best
  );
}

/**
 * Select frame with highest OCR confidence
 */
function selectHighestConfidenceFrame(results: FrameOCRResult[]): FrameOCRResult {
  return results.reduce((best, current) =>
    current.confidence > best.confidence ? current : best
  );
}

// ========================================
// Text Appearance Detection
// ========================================

/**
 * Find the position where text first appears
 */
function findTextAppearancePosition(results: FrameOCRResult[]): number | undefined {
  for (const result of results) {
    if (result.text.trim().length > 0) {
      return result.position;
    }
  }
  return undefined;
}

/**
 * Find the position where text becomes stable (same as next frame)
 */
function findTextStabilityPosition(results: FrameOCRResult[]): number | undefined {
  const normalizeText = (text: string): string =>
    text.trim().toLowerCase().replace(/\s+/g, ' ');

  for (let i = 0; i < results.length - 1; i++) {
    const current = results[i];
    const next = results[i + 1];

    const currentNorm = normalizeText(current.text);
    const nextNorm = normalizeText(next.text);

    if (currentNorm.length > 0 && currentNorm === nextNorm) {
      return current.position;
    }
  }
  return undefined;
}

// ========================================
// Batch Processing
// ========================================

/**
 * Process multiple scenes with multi-frame OCR
 *
 * @param scenes - Scenes to process
 * @param videoPath - Path to video file
 * @param outputDir - Directory for temporary frames
 * @param uploadId - Optional upload ID for progress tracking
 * @returns Scenes with OCR results
 */
export async function processMultiFrameOCRBatch(
  scenes: Scene[],
  videoPath: string,
  outputDir: string,
  uploadId?: string
): Promise<SceneWithMultiFrameOCR[]> {
  console.log(`\n🔍 Running Multi-Frame OCR on ${scenes.length} scenes...`);

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
  const rateLimiter = new SimpleRateLimiter(30); // 30 requests per minute
  const limit = pLimit(3); // Process 3 scenes at a time

  const results: SceneWithMultiFrameOCR[] = [];
  let completed = 0;

  const processScene = async (scene: Scene): Promise<SceneWithMultiFrameOCR> => {
    // Extract multiple frames
    const frames = await extractMultipleFrames(videoPath, scene, outputDir);

    // Perform multi-frame OCR
    const multiFrameResult = await performMultiFrameOCR(
      scene,
      frames,
      model,
      rateLimiter,
      { strategy: 'first_stable' }
    );

    // Cleanup non-best frames
    for (const frame of frames) {
      if (frame.path !== multiFrameResult.bestFrame.path) {
        await fs.unlink(frame.path).catch(() => {});
      }
    }

    completed++;
    console.log(`  [${completed}/${scenes.length}] Scene ${scene.sceneNumber}: "${multiFrameResult.bestFrame.text.substring(0, 30)}..."`);

    return {
      ...scene,
      screenshotPath: multiFrameResult.bestFrame.path,
      ocrText: multiFrameResult.bestFrame.text,
      ocrConfidence: multiFrameResult.bestFrame.confidence,
      textAppearancePosition: multiFrameResult.textAppearancePosition,
      textStabilityPosition: multiFrameResult.textStabilityPosition
    };
  };

  // Process scenes in parallel batches
  const batchResults = await Promise.all(
    scenes.map(scene => limit(() => processScene(scene)))
  );

  results.push(...batchResults);

  console.log(`  Multi-Frame OCR complete: ${results.filter(r => r.ocrText.length > 0).length}/${results.length} scenes with text`);

  return results;
}
