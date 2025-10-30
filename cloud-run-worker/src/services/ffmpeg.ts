/**
 * FFmpeg Scene Detection Service
 * Implements multi-pass scene detection with mid-point frame extraction
 * Based on VideoContentAnalyzer V2's proven algorithm (100% OCR accuracy)
 *
 * Adapted from V1 for V2 architecture with Scene interface
 */

import ffmpeg from 'fluent-ffmpeg';
import { promises as fs } from 'fs';
import path from 'path';
import { Scene, SceneCut, VideoMetadata } from '../types/excel';
import { formatTimecode } from '../utils/timecode';

/**
 * Scene detection configuration
 */
interface SceneDetectionConfig {
  thresholds: number[]; // FFmpeg scene thresholds [0.03, 0.05, 0.10]
  minSceneDuration: number; // Minimum scene duration in seconds (0.5s default)
}

/**
 * Default configuration based on V2 implementation
 */
const DEFAULT_CONFIG: SceneDetectionConfig = {
  thresholds: [0.03, 0.05, 0.10], // Multi-pass detection for maximum accuracy
  minSceneDuration: 0.5 // Filter out very short scenes
};

/**
 * Multi-pass FFmpeg scene detection
 * Runs detection with multiple thresholds and merges results
 * @param videoPath - Path to the video file
 * @param config - Detection configuration
 * @returns Array of scene cuts with confidence scores
 */
async function detectSceneCuts(
  videoPath: string,
  config: SceneDetectionConfig = DEFAULT_CONFIG
): Promise<SceneCut[]> {
  const allCuts = new Map<number, number>(); // timestamp -> confidence

  console.log(`🔍 Starting multi-pass scene detection with thresholds: ${config.thresholds.join(', ')}`);

  for (const threshold of config.thresholds) {
    console.log(`  📊 Running detection pass with threshold ${threshold}...`);

    const cuts = await runSceneDetection(videoPath, threshold);
    console.log(`  ✓ Found ${cuts.length} cuts at threshold ${threshold}`);

    // Merge cuts with maximum confidence
    cuts.forEach(cut => {
      const existingConfidence = allCuts.get(cut.timestamp) || 0;
      allCuts.set(cut.timestamp, Math.max(existingConfidence, cut.confidence));
    });
  }

  // Convert map to array and sort by timestamp
  const mergedCuts = Array.from(allCuts.entries())
    .map(([timestamp, confidence]) => ({ timestamp, confidence }))
    .sort((a, b) => a.timestamp - b.timestamp);

  console.log(`✅ Multi-pass detection complete: ${mergedCuts.length} total scene cuts`);
  return mergedCuts;
}

/**
 * Run FFmpeg scene detection with single threshold
 * @param videoPath - Path to the video file
 * @param threshold - Scene detection threshold (0.0-1.0)
 * @returns Array of scene cuts
 */
function runSceneDetection(videoPath: string, threshold: number): Promise<SceneCut[]> {
  return new Promise((resolve, reject) => {
    const cuts: SceneCut[] = [];

    ffmpeg(videoPath)
      .outputOptions([
        '-vf', `select='gt(scene,${threshold})',showinfo`,
        '-f', 'null'
      ])
      .output('-')
      .on('stderr', (stderrLine: string) => {
        // Parse FFmpeg output for scene timestamps
        // Format: "pts_time:12.345 pos:678912 ..."
        const match = stderrLine.match(/pts_time:(\d+\.?\d*)/);
        if (match) {
          const timestamp = parseFloat(match[1]);
          cuts.push({
            timestamp: Math.floor(timestamp * 10) / 10, // Round to 0.1s precision
            confidence: threshold
          });
        }
      })
      .on('end', () => resolve(cuts))
      .on('error', (err) => reject(err))
      .run();
  });
}

/**
 * Generate scene ranges from detected cuts
 * Calculates mid-point (50% between scene detection points)
 * @param cuts - Array of scene cuts
 * @param videoDuration - Total video duration in seconds
 * @param config - Scene detection configuration
 * @returns Array of scene ranges with mid-points
 */
async function generateSceneRanges(
  cuts: SceneCut[],
  videoDuration: number,
  config: SceneDetectionConfig = DEFAULT_CONFIG
): Promise<Scene[]> {
  const scenes: Scene[] = [];
  let sceneNumber = 1;

  console.log(`📐 Generating scene ranges from ${cuts.length} cuts...`);

  for (let i = 0; i < cuts.length; i++) {
    const startTime = cuts[i].timestamp;
    const endTime = i < cuts.length - 1 ? cuts[i + 1].timestamp : videoDuration;
    const duration = endTime - startTime;

    // Filter out very short scenes
    // Note: sceneNumber increments ONLY for valid scenes (duration >= minSceneDuration)
    // This ensures sequential numbering (1, 2, 3...) even when short scenes are skipped
    if (duration < config.minSceneDuration) {
      console.log(`  ⏭️  Skipping short scene (${duration.toFixed(2)}s < ${config.minSceneDuration}s)`);
      continue;  // Skip without consuming a scene number
    }

    // Calculate mid-point (50% between detection points)
    const midTime = (startTime + endTime) / 2;

    scenes.push({
      sceneNumber,
      startTime, // Detection point A (前)
      endTime, // Detection point B (後)
      midTime, // 50% position for screenshot
      timecode: formatTimecode(startTime) // Timecode assigned to scene start
    });

    sceneNumber++;
  }

  console.log(`✅ Generated ${scenes.length} valid scene ranges`);
  return scenes;
}

/**
 * Extract frame at specific timestamp
 * @param videoPath - Path to the video file
 * @param timestamp - Time in seconds
 * @param outputPath - Output file path for frame
 */
async function extractFrameAtTime(
  videoPath: string,
  timestamp: number,
  outputPath: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .seekInput(timestamp)
      .frames(1)
      .size('1280x720') // Optimize size for OCR
      .output(outputPath)
      .on('end', () => resolve())
      .on('error', (err) => reject(err))
      .run();
  });
}

/**
 * Get video metadata (duration, width, height, aspect ratio)
 */
export function getVideoMetadata(videoPath: string): Promise<VideoMetadata> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err) {
        reject(err);
      } else {
        const duration = Math.floor(metadata.format.duration || 0);
        const videoStream = metadata.streams.find(s => s.codec_type === 'video');

        if (!videoStream || !videoStream.width || !videoStream.height) {
          reject(new Error('Could not extract video dimensions from metadata'));
          return;
        }

        const width = videoStream.width;
        const height = videoStream.height;
        const aspectRatio = width / height;

        console.log(`📹 Video Metadata: ${width}x${height} (${aspectRatio.toFixed(2)}:1), ${duration}s`);

        resolve({
          width,
          height,
          aspectRatio,
          duration
        });
      }
    });
  });
}

/**
 * Get video duration in seconds (helper function)
 */
function getVideoDuration(videoPath: string): Promise<number> {
  return getVideoMetadata(videoPath).then(metadata => metadata.duration);
}

/**
 * Main scene detection and frame extraction function
 * Implements FFmpeg scene detection + mid-point frame extraction
 * @param videoPath - Path to the video file
 * @param outputDir - Directory for extracted frames (optional, defaults to /tmp/frames-{timestamp})
 * @returns Array of Scene objects with screenshot paths
 */
export async function extractScenesWithFrames(
  videoPath: string,
  outputDir?: string
): Promise<Scene[]> {
  const framesDir = outputDir || path.join('/tmp', `frames-${Date.now()}`);

  try {
    // Create output directory
    await fs.mkdir(framesDir, { recursive: true });
    console.log(`📁 Created output directory: ${framesDir}`);

    // Get video duration
    const duration = await getVideoDuration(videoPath);
    console.log(`🎬 Video duration: ${duration}s`);

    // Step 1: Multi-pass scene detection
    const cuts = await detectSceneCuts(videoPath);

    if (cuts.length === 0) {
      console.warn('⚠️ No scene cuts detected, falling back to single scene');
      // Fallback: treat entire video as one scene
      cuts.push({ timestamp: 0, confidence: 0.03 });
    }

    // Step 2: Generate scene ranges with mid-points
    const scenes = await generateSceneRanges(cuts, duration);

    console.log(`📸 Extracting ${scenes.length} frames at mid-points...`);

    // Step 3: Extract frames at mid-points
    for (const scene of scenes) {
      const filename = path.join(framesDir, `scene-${scene.sceneNumber.toString().padStart(4, '0')}.png`);

      await extractFrameAtTime(videoPath, scene.midTime, filename);

      // Set screenshot path
      scene.screenshotPath = filename;

      console.log(`  ✓ Scene ${scene.sceneNumber}: ${scene.timecode} (mid-point: ${scene.midTime.toFixed(1)}s)`);
    }

    console.log(`✅ Extracted ${scenes.length} frames at mid-points`);
    return scenes;

  } catch (error) {
    // Clean up on error
    try {
      await fs.rm(framesDir, { recursive: true, force: true });
    } catch (cleanupError) {
      console.error('⚠️ Cleanup error:', cleanupError);
    }
    throw error;
  }
}

/**
 * Clean up temporary frame files
 * @param scenes - Array of scenes with screenshot paths
 */
export async function cleanupFrames(scenes: Scene[]): Promise<void> {
  if (scenes.length === 0 || !scenes[0].screenshotPath) return;

  const outputDir = path.dirname(scenes[0].screenshotPath);

  try {
    await fs.rm(outputDir, { recursive: true, force: true });
    console.log(`🧹 Cleaned up temporary frames: ${outputDir}`);
  } catch (error) {
    console.error('⚠️ Error cleaning up frames:', error);
  }
}
