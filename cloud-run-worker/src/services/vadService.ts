import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { NonRealTimeVAD } from 'avr-vad';
import { extractAudioChunk as extractChunkWithFFmpeg } from './audioExtractor.js';
import ffmpeg from 'fluent-ffmpeg';

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Voice Activity Detection (VAD) Service using Silero VAD v5
 *
 * Detects voice segments in audio files and splits them into chunks
 * for efficient Whisper API processing.
 *
 * Benefits:
 * - 40-60% cost reduction by skipping silent portions
 * - Prevents hallucination on silent audio
 * - Enables optimal 10-second chunking for Whisper
 */

export interface VoiceSegment {
  /** Start time in seconds */
  startTime: number;
  /** End time in seconds */
  endTime: number;
  /** Duration in seconds */
  duration: number;
  /** Confidence score (0-1) */
  confidence: number;
}

export interface AudioChunk {
  /** Chunk index (0-based) */
  chunkIndex: number;
  /** Start time in seconds */
  startTime: number;
  /** End time in seconds */
  endTime: number;
  /** Duration in seconds */
  duration: number;
  /** Path to extracted audio chunk file */
  filePath: string;
  /** Voice segments within this chunk */
  voiceSegments: VoiceSegment[];
}

export interface VADConfig {
  /** Maximum chunk duration in seconds (default: 10) */
  maxChunkDuration?: number;
  /** Minimum speech duration to keep in seconds (default: 0.25) */
  minSpeechDuration?: number;
  /** VAD sensitivity (0-1, higher = more sensitive, default: 0.5) */
  sensitivity?: number;
}

export interface VADResult {
  /** Total audio duration in seconds */
  totalDuration: number;
  /** Total voice duration in seconds */
  totalVoiceDuration: number;
  /** Detected voice segments */
  voiceSegments: VoiceSegment[];
  /** Audio chunks ready for Whisper */
  audioChunks: AudioChunk[];
  /** Voice activity ratio (0-1) */
  voiceRatio: number;
  /** Estimated cost savings vs processing full audio */
  estimatedSavings: number;
}

const DEFAULT_CONFIG: Required<VADConfig> = {
  maxChunkDuration: 10,  // 10-second chunks for Whisper
  minSpeechDuration: 0.25,  // Filter out very short segments
  sensitivity: 0.5,  // Balanced sensitivity
};

/**
 * Validate file path to prevent path traversal attacks
 *
 * @param filePath - Path to validate
 * @throws Error if path is outside allowed directory
 */
function validateFilePath(filePath: string): void {
  const normalizedPath = path.resolve(filePath);
  const allowedDir = path.resolve(os.tmpdir());

  if (!normalizedPath.startsWith(allowedDir)) {
    throw new Error(
      `Invalid file path: must be within ${allowedDir}. ` +
      `Attempted path: ${normalizedPath}`
    );
  }
}

/**
 * Process audio file with VAD and split into chunks
 *
 * @param audioPath - Path to audio file (MP3, WAV, etc.)
 * @param outputDir - Directory to save audio chunks
 * @param config - Optional VAD configuration
 * @returns VAD processing result with detected segments and chunks
 *
 * @example
 * ```typescript
 * const result = await processAudioWithVAD(
 *   '/tmp/audio.mp3',
 *   '/tmp/chunks'
 * );
 * console.log(`Voice ratio: ${result.voiceRatio * 100}%`);
 * console.log(`Chunks: ${result.audioChunks.length}`);
 * ```
 */
export async function processAudioWithVAD(
  audioPath: string,
  outputDir: string,
  config: VADConfig = {}
): Promise<VADResult> {
  // Validate file paths (security)
  validateFilePath(audioPath);
  validateFilePath(outputDir);

  const finalConfig = { ...DEFAULT_CONFIG, ...config };

  console.log(`[VAD] Starting voice activity detection: ${path.basename(audioPath)}`);
  console.log(`[VAD] Config:`, finalConfig);

  // Create output directory
  await fs.promises.mkdir(outputDir, { recursive: true });

  // Detect voice segments
  const voiceSegments = await detectVoiceSegments(audioPath, finalConfig);

  console.log(`[VAD] Detected ${voiceSegments.length} voice segments`);

  // Filter out very short segments
  const filteredSegments = voiceSegments.filter(
    seg => seg.duration >= finalConfig.minSpeechDuration
  );

  console.log(`[VAD] After filtering: ${filteredSegments.length} segments (min ${finalConfig.minSpeechDuration}s)`);

  // Split into chunks
  const audioChunks = await splitIntoChunks(
    audioPath,
    filteredSegments,
    outputDir,
    finalConfig.maxChunkDuration
  );

  // Calculate statistics
  const totalDuration = voiceSegments.length > 0
    ? Math.max(...voiceSegments.map(s => s.endTime))
    : 0;

  const totalVoiceDuration = filteredSegments.reduce(
    (sum, seg) => sum + seg.duration,
    0
  );

  const voiceRatio = totalDuration > 0 ? totalVoiceDuration / totalDuration : 0;

  // Estimated cost savings (Whisper API pricing: ~$0.006/min)
  const fullAudioCost = (totalDuration / 60) * 0.006;
  const vadAudioCost = (totalVoiceDuration / 60) * 0.006;
  const estimatedSavings = ((fullAudioCost - vadAudioCost) / fullAudioCost) * 100;

  const result: VADResult = {
    totalDuration,
    totalVoiceDuration,
    voiceSegments: filteredSegments,
    audioChunks,
    voiceRatio,
    estimatedSavings,
  };

  console.log(`[VAD] ✓ Processing complete`);
  console.log(`[VAD]   Total duration: ${totalDuration.toFixed(2)}s`);
  console.log(`[VAD]   Voice duration: ${totalVoiceDuration.toFixed(2)}s`);
  console.log(`[VAD]   Voice ratio: ${(voiceRatio * 100).toFixed(1)}%`);
  console.log(`[VAD]   Estimated savings: ${estimatedSavings.toFixed(1)}%`);
  console.log(`[VAD]   Audio chunks: ${audioChunks.length}`);

  return result;
}

/**
 * Load audio file as Float32Array for VAD processing
 *
 * @param audioPath - Path to audio file
 * @returns Float32Array of audio samples at 16kHz mono
 */
async function loadAudioAsFloat32Array(audioPath: string): Promise<Float32Array> {
  return new Promise((resolve, reject) => {
    const pcmPath = audioPath.replace(/\.[^/.]+$/, '.pcm');

    // Timeout configuration (2 minutes)
    const TIMEOUT_MS = 120000;

    // Convert audio to raw PCM (16kHz mono, 16-bit signed integer)
    const command = ffmpeg(audioPath)
      .audioCodec('pcm_s16le')
      .audioFrequency(16000)
      .audioChannels(1)
      .format('s16le')  // Signed 16-bit little-endian PCM
      .output(pcmPath);

    let isTimedOut = false;

    // Timeout handler
    const timeoutId = setTimeout(() => {
      isTimedOut = true;
      console.error(`[VAD] ✗ PCM conversion timed out after ${TIMEOUT_MS}ms`);
      try {
        command.kill('SIGKILL');
      } catch (killError) {
        console.error(`[VAD] Failed to kill FFmpeg process:`, killError);
      }
      reject(new Error(`PCM conversion timed out after ${TIMEOUT_MS}ms`));
    }, TIMEOUT_MS);

    command
      .on('end', async () => {
        if (isTimedOut) return;
        try {
          // Read PCM file as buffer
          const buffer = await fs.promises.readFile(pcmPath);

          // Convert 16-bit PCM to Float32Array (-1.0 to 1.0)
          const samples = new Float32Array(buffer.length / 2);
          for (let i = 0; i < samples.length; i++) {
            const sample = buffer.readInt16LE(i * 2);
            samples[i] = sample / 32768.0;  // Normalize to -1.0 ~ 1.0
          }

          // Cleanup PCM file
          clearTimeout(timeoutId);
          try {
            await fs.promises.unlink(pcmPath);
            console.log(`[VAD] PCM file cleaned up: ${path.basename(pcmPath)}`);
          } catch (cleanupError) {
            console.warn(`[VAD] Failed to cleanup PCM file (${path.basename(pcmPath)}):`,
              cleanupError instanceof Error ? cleanupError.message : cleanupError);
          }

          resolve(samples);
        } catch (error) {
          clearTimeout(timeoutId);
          reject(error);
        }
      })
      .on('error', (error) => {
        clearTimeout(timeoutId);
        if (!isTimedOut) {
          reject(new Error(`Failed to convert audio to PCM: ${error.message}`));
        }
      });

    command.run();
  });
}

/**
 * Detect voice segments in audio file using Silero VAD
 *
 * @param audioPath - Path to audio file
 * @param config - VAD configuration
 * @returns Detected voice segments
 */
async function detectVoiceSegments(
  audioPath: string,
  config: Required<VADConfig>
): Promise<VoiceSegment[]> {
  console.log(`[VAD] Loading audio for VAD processing...`);

  // Load audio as Float32Array
  const audioData = await loadAudioAsFloat32Array(audioPath);

  console.log(`[VAD] Audio loaded: ${audioData.length} samples (${(audioData.length / 16000).toFixed(2)}s)`);

  // Initialize VAD with custom model fetcher for Node.js environment
  console.log(`[VAD] Initializing VAD with Silero model...`);

  // Resolve model path relative to this compiled file
  // In development: cloud-run-worker/dist/services/vadService.js
  // Model location: cloud-run-worker/node_modules/avr-vad/silero_vad_legacy.onnx
  const modelPath = path.resolve(__dirname, '../../node_modules/avr-vad/silero_vad_legacy.onnx');

  console.log(`[VAD] Model path: ${modelPath}`);

  // Verify model file exists
  if (!fs.existsSync(modelPath)) {
    throw new Error(
      `VAD model file not found: ${modelPath}. ` +
      `Please ensure avr-vad is installed correctly.`
    );
  }

  const vad = await NonRealTimeVAD.new({
    positiveSpeechThreshold: config.sensitivity,
    negativeSpeechThreshold: config.sensitivity * 0.7,  // Lower threshold for end
    modelFetcher: async () => {
      console.log(`[VAD] Loading model from filesystem: ${path.basename(modelPath)}`);
      const buffer = await fs.promises.readFile(modelPath);
      // Return ArrayBuffer (avr-vad expects ArrayBuffer)
      return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    },
  });

  console.log(`[VAD] VAD initialized successfully`);

  const segments: VoiceSegment[] = [];

  // Process audio and collect speech segments
  for await (const speechData of vad.run(audioData, 16000)) {
    segments.push({
      startTime: speechData.start / 1000,  // Convert ms to seconds
      endTime: speechData.end / 1000,
      duration: (speechData.end - speechData.start) / 1000,
      confidence: 0.9,  // VAD doesn't provide probability per segment
    });
  }

  return segments;
}

/**
 * Split voice segments into fixed-duration chunks
 *
 * @param audioPath - Original audio file path
 * @param segments - Detected voice segments
 * @param outputDir - Output directory for chunks
 * @param maxDuration - Maximum chunk duration in seconds
 * @returns Array of audio chunks
 */
async function splitIntoChunks(
  audioPath: string,
  segments: VoiceSegment[],
  outputDir: string,
  maxDuration: number
): Promise<AudioChunk[]> {
  const chunks: AudioChunk[] = [];

  if (segments.length === 0) {
    console.log(`[VAD] No voice segments detected, returning empty chunks`);
    return chunks;
  }

  let chunkIndex = 0;
  let currentChunkSegments: VoiceSegment[] = [];
  let currentChunkStart = segments[0].startTime;
  let currentChunkEnd = currentChunkStart;

  for (const segment of segments) {
    const potentialEnd = segment.endTime;
    const potentialDuration = potentialEnd - currentChunkStart;

    if (potentialDuration > maxDuration && currentChunkSegments.length > 0) {
      // Create chunk from accumulated segments
      const chunkPath = path.join(outputDir, `chunk-${chunkIndex.toString().padStart(4, '0')}.mp3`);

      chunks.push({
        chunkIndex,
        startTime: currentChunkStart,
        endTime: currentChunkEnd,
        duration: currentChunkEnd - currentChunkStart,
        filePath: chunkPath,
        voiceSegments: [...currentChunkSegments],
      });

      chunkIndex++;
      currentChunkSegments = [segment];
      currentChunkStart = segment.startTime;
      currentChunkEnd = segment.endTime;
    } else {
      // Add segment to current chunk
      currentChunkSegments.push(segment);
      currentChunkEnd = segment.endTime;
    }
  }

  // Add final chunk
  if (currentChunkSegments.length > 0) {
    const chunkPath = path.join(outputDir, `chunk-${chunkIndex.toString().padStart(4, '0')}.mp3`);

    chunks.push({
      chunkIndex,
      startTime: currentChunkStart,
      endTime: currentChunkEnd,
      duration: currentChunkEnd - currentChunkStart,
      filePath: chunkPath,
      voiceSegments: currentChunkSegments,
    });
  }

  console.log(`[VAD] Split into ${chunks.length} chunks (max ${maxDuration}s each)`);

  return chunks;
}

/**
 * Extract audio chunk from original file using ffmpeg
 *
 * @param audioPath - Original audio file
 * @param chunk - Chunk metadata
 * @returns Path to extracted chunk file
 */
export async function extractAudioChunk(
  audioPath: string,
  chunk: AudioChunk
): Promise<string> {
  await extractChunkWithFFmpeg(
    audioPath,
    chunk.filePath,
    chunk.startTime,
    chunk.duration
  );

  return chunk.filePath;
}

/**
 * Cleanup VAD temporary files
 *
 * @param outputDir - Directory containing chunk files
 */
export async function cleanupVADFiles(outputDir: string): Promise<void> {
  try {
    await fs.promises.rm(outputDir, { recursive: true, force: true });
    console.log(`[VAD] Cleaned up temporary files: ${outputDir}`);
  } catch (error) {
    console.error(`[VAD] Failed to cleanup files:`, error);
  }
}
