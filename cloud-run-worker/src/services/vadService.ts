import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { NonRealTimeVAD } from 'avr-vad';
import { extractAudioChunk as extractChunkWithFFmpeg } from './audioExtractor.js';
import ffmpeg from 'fluent-ffmpeg';
import { DEFAULT_VAD_CONFIG, WHISPER_COST, type VADConfig } from '../config/vad.js';
import { validateFilePath } from '../utils/security.js';
import { TIMEOUTS } from '../config/timeouts.js';

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Voice Activity Detection (VAD) Service using Silero VAD
 *
 * Detects voice segments in audio files and splits them into chunks
 * for efficient Whisper API processing.
 *
 * Benefits:
 * - 40-60% cost reduction by skipping silent portions
 * - Prevents hallucination on silent audio
 * - Enables optimal 10-second chunking for Whisper
 *
 * Note: Uses legacy model (NonRealTimeVAD only supports legacy model)
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
 *
 * Note: For pre-chunked audio, timestamp offsets are applied during
 * the merge phase in audioWhisperPipeline.ts, not here.
 */
export async function processAudioWithVAD(
  audioPath: string,
  outputDir: string,
  config: VADConfig = {}
): Promise<VADResult> {
  // Validate file paths (security)
  validateFilePath(audioPath);
  validateFilePath(outputDir);

  // Use centralized VAD configuration
  const finalConfig = { ...DEFAULT_VAD_CONFIG, ...config };

  console.log(`[VAD] Starting voice activity detection: ${path.basename(audioPath)}`);
  console.log(`[VAD] Config:`, finalConfig);

  // Create output directory
  await fs.promises.mkdir(outputDir, { recursive: true });

  // Detect voice segments (local timestamps, relative to audio file start)
  const voiceSegments = await detectVoiceSegments(audioPath, finalConfig);

  console.log(`[VAD] Detected ${voiceSegments.length} voice segments`);

  // Filter out very short segments
  const filteredSegments = voiceSegments.filter(
    seg => seg.duration >= finalConfig.minSpeechDuration
  );

  // Log excluded segments for analysis
  const excludedCount = voiceSegments.length - filteredSegments.length;
  console.log(`[VAD] After filtering: ${filteredSegments.length} segments (min ${finalConfig.minSpeechDuration}s)`);

  if (excludedCount > 0) {
    console.log(`[VAD] ⚠️ Excluded ${excludedCount} short segments (<${finalConfig.minSpeechDuration}s):`);
    const excludedSegments = voiceSegments.filter(
      seg => seg.duration < finalConfig.minSpeechDuration
    );

    // Show first 5 excluded segments for debugging
    const samplesToShow = Math.min(5, excludedSegments.length);
    for (let i = 0; i < samplesToShow; i++) {
      const seg = excludedSegments[i];
      console.log(`[VAD]   - ${seg.startTime.toFixed(2)}s~${seg.endTime.toFixed(2)}s (${seg.duration.toFixed(2)}s)`);
    }

    if (excludedSegments.length > samplesToShow) {
      console.log(`[VAD]   ... and ${excludedSegments.length - samplesToShow} more`);
    }

    // Calculate statistics
    const totalExcludedDuration = excludedSegments.reduce((sum, seg) => sum + seg.duration, 0);
    const avgExcludedDuration = totalExcludedDuration / excludedSegments.length;
    console.log(`[VAD] 📊 Excluded segments statistics:`);
    console.log(`[VAD]   - Total excluded duration: ${totalExcludedDuration.toFixed(2)}s`);
    console.log(`[VAD]   - Average excluded duration: ${avgExcludedDuration.toFixed(2)}s`);
    // Use reduce instead of spread to avoid "Maximum call stack size exceeded" for large arrays
    const shortestExcluded = excludedSegments.reduce((min, s) => Math.min(min, s.duration), Infinity);
    const longestExcluded = excludedSegments.reduce((max, s) => Math.max(max, s.duration), -Infinity);
    console.log(`[VAD]   - Shortest excluded: ${shortestExcluded.toFixed(2)}s`);
    console.log(`[VAD]   - Longest excluded: ${longestExcluded.toFixed(2)}s`);
  } else {
    console.log(`[VAD] ✓ No segments excluded (all segments >= ${finalConfig.minSpeechDuration}s)`);
  }

  // Split into chunks
  const audioChunks = await splitIntoChunks(
    audioPath,
    filteredSegments,
    outputDir,
    finalConfig.maxChunkDuration
  );

  // Calculate statistics
  // Use reduce instead of spread to avoid "Maximum call stack size exceeded" for large arrays
  const totalDuration = voiceSegments.length > 0
    ? voiceSegments.reduce((max, s) => Math.max(max, s.endTime), -Infinity)
    : 0;

  const totalVoiceDuration = filteredSegments.reduce(
    (sum, seg) => sum + seg.duration,
    0
  );

  const voiceRatio = totalDuration > 0 ? totalVoiceDuration / totalDuration : 0;

  // Estimated cost savings (Whisper API pricing)
  const fullAudioCost = (totalDuration / 60) * WHISPER_COST.PER_MINUTE;
  const vadAudioCost = (totalVoiceDuration / 60) * WHISPER_COST.PER_MINUTE;
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
  console.log(`[VAD] [PCM] Starting PCM conversion: ${path.basename(audioPath)}`);

  return new Promise((resolve, reject) => {
    const pcmPath = audioPath.replace(/\.[^/.]+$/, '.pcm');
    console.log(`[VAD] [PCM] Output path: ${path.basename(pcmPath)}`);

    const TIMEOUT_MS = TIMEOUTS.PCM_CONVERSION;
    console.log(`[VAD] [PCM] Timeout: ${TIMEOUT_MS}ms (${TIMEOUT_MS / 1000}s)`);

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
      .on('start', (commandLine) => {
        console.log(`[VAD] [PCM] FFmpeg command: ${commandLine}`);
      })
      .on('end', async () => {
        if (isTimedOut) return;
        try {
          console.log(`[VAD] [PCM] ✓ FFmpeg conversion complete`);

          // Read PCM file as buffer
          const buffer = await fs.promises.readFile(pcmPath);
          console.log(`[VAD] [PCM] ✓ Read PCM buffer: ${buffer.length} bytes`);

          // Convert 16-bit PCM to Float32Array (-1.0 to 1.0)
          const samples = new Float32Array(buffer.length / 2);
          for (let i = 0; i < samples.length; i++) {
            const sample = buffer.readInt16LE(i * 2);
            samples[i] = sample / 32768.0;  // Normalize to -1.0 ~ 1.0
          }
          console.log(`[VAD] [PCM] ✓ Converted to Float32Array: ${samples.length} samples`);

          // Cleanup PCM file
          clearTimeout(timeoutId);
          try {
            await fs.promises.unlink(pcmPath);
            console.log(`[VAD] [PCM] ✓ Cleanup complete: ${path.basename(pcmPath)}`);
          } catch (cleanupError) {
            console.warn(`[VAD] [PCM] ⚠️ Failed to cleanup PCM file (${path.basename(pcmPath)}):`,
              cleanupError instanceof Error ? cleanupError.message : cleanupError);
          }

          resolve(samples);
        } catch (error) {
          clearTimeout(timeoutId);
          console.error(`[VAD] [PCM] ✗ Post-processing failed:`, error);
          reject(error);
        }
      })
      .on('error', (error) => {
        clearTimeout(timeoutId);
        if (!isTimedOut) {
          console.error(`[VAD] [PCM] ✗ FFmpeg error:`, error.message);
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
  console.log(`[VAD] ═══════ STARTING VAD DETECTION ═══════`);
  console.log(`[VAD] Audio file: ${path.basename(audioPath)}`);
  console.log(`[VAD] Config: sensitivity=${config.sensitivity}, minSpeechDuration=${config.minSpeechDuration}s`);

  // Load audio as Float32Array
  let audioData: Float32Array;
  try {
    console.log(`[VAD] Step 1/3: Loading audio for VAD processing...`);
    audioData = await loadAudioAsFloat32Array(audioPath);
    console.log(`[VAD] ✓ Step 1/3: Audio loaded: ${audioData.length} samples (${(audioData.length / 16000).toFixed(2)}s)`);
  } catch (loadError) {
    console.error(`[VAD] ✗ Step 1/3: Failed to load audio:`, loadError);
    throw loadError;
  }

  // Initialize VAD with Silero VAD legacy model (NonRealTimeVAD requires legacy model)
  let vad: NonRealTimeVAD;
  try {
    console.log(`[VAD] Step 2/3: Initializing VAD with Silero legacy model...`);

    // Resolve model path - use legacy model (NonRealTimeVAD only supports legacy)
    const modelPath = path.resolve(__dirname, '../../node_modules/avr-vad/silero_vad_legacy.onnx');
    console.log(`[VAD] Model path: ${modelPath}`);

    // Verify model file exists
    if (!fs.existsSync(modelPath)) {
      throw new Error(
        `VAD legacy model file not found: ${modelPath}. ` +
        `Please ensure avr-vad is installed correctly with legacy model.`
      );
    }

    vad = await NonRealTimeVAD.new({
      positiveSpeechThreshold: config.sensitivity,
      negativeSpeechThreshold: config.sensitivity * 0.7,  // Lower threshold for end
      modelFetcher: async () => {
        console.log(`[VAD] Loading legacy model from filesystem: ${path.basename(modelPath)}`);
        const buffer = await fs.promises.readFile(modelPath);
        // Return ArrayBuffer (avr-vad expects ArrayBuffer)
        return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
      },
    });

    console.log(`[VAD] ✓ Step 2/3: VAD initialized successfully`);
  } catch (vadInitError) {
    console.error(`[VAD] ✗ Step 2/3: Failed to initialize VAD:`, vadInitError);
    throw vadInitError;
  }

  // Process audio and collect speech segments
  const segments: VoiceSegment[] = [];
  try {
    console.log(`[VAD] Step 3/3: Running VAD inference on ${audioData.length} samples...`);
    let segmentCount = 0;

    for await (const speechData of vad.run(audioData, 16000)) {
      segments.push({
        startTime: speechData.start / 1000,  // Convert ms to seconds
        endTime: speechData.end / 1000,
        duration: (speechData.end - speechData.start) / 1000,
        confidence: 0.9,  // VAD doesn't provide probability per segment
      });
      segmentCount++;

      // Log progress every 10 segments
      if (segmentCount % 10 === 0) {
        console.log(`[VAD] ... detected ${segmentCount} segments so far`);
      }
    }

    console.log(`[VAD] ✓ Step 3/3: VAD inference complete - detected ${segments.length} segments`);
  } catch (vadRunError) {
    console.error(`[VAD] ✗ Step 3/3: Failed during VAD inference:`, vadRunError);
    throw vadRunError;
  }

  // VAD detection statistics (added 2025-11-12 for diagnosis)
  console.log(`[VAD] 🔍 Raw segments detected (before filtering): ${segments.length}`);

  if (segments.length > 0) {
    const durationsHistogram = [
      { range: '0.00-0.10s', count: segments.filter(s => s.duration < 0.1).length },
      { range: '0.10-0.25s', count: segments.filter(s => s.duration >= 0.1 && s.duration < 0.25).length },
      { range: '0.25-0.50s', count: segments.filter(s => s.duration >= 0.25 && s.duration < 0.5).length },
      { range: '0.50-1.00s', count: segments.filter(s => s.duration >= 0.5 && s.duration < 1.0).length },
      { range: '1.00s+', count: segments.filter(s => s.duration >= 1.0).length },
    ];

    console.log(`[VAD] 📊 Duration distribution (before filtering):`);
    durationsHistogram.forEach(h => {
      const percentage = segments.length > 0 ? ((h.count / segments.length) * 100).toFixed(1) : '0.0';
      console.log(`[VAD]   ${h.range}: ${h.count} (${percentage}%)`);
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
