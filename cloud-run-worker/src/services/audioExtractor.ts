import ffmpeg from 'fluent-ffmpeg';
import path from 'path';
import fs from 'fs/promises';
import { validateFilePath } from '../utils/security.js';
import { TIMEOUTS, getTimeoutMinutes } from '../config/timeouts.js';

/**
 * Audio Extraction Service optimized for OpenAI Whisper API
 *
 * Follows OpenAI's recommendations:
 * https://platform.openai.com/docs/guides/speech-to-text
 *
 * - Format: MP3 (16kHz mono)
 * - Noise reduction: highpass + lowpass filters
 * - Volume normalization for consistent levels
 * - Optimized for speech-to-text accuracy
 */

export interface AudioExtractionConfig {
  /** Sample rate (default: 16000 Hz for Whisper) */
  sampleRate?: number;
  /** Audio channels (default: 1 for mono) */
  channels?: number;
  /** Enable noise reduction filters (default: true) */
  noiseReduction?: boolean;
  /** Volume normalization (default: true) */
  volumeNormalization?: boolean;
  /** Audio bitrate (default: 64k for speech) */
  bitrate?: string;
}

const DEFAULT_CONFIG: Required<AudioExtractionConfig> = {
  sampleRate: 16000,  // 16kHz recommended by OpenAI
  channels: 1,        // Mono for speech
  noiseReduction: true,
  volumeNormalization: true,
  bitrate: '64k',     // Sufficient for speech
};

/**
 * Extract audio from video file optimized for Whisper transcription
 *
 * @param videoPath - Path to input video file
 * @param outputPath - Path to output MP3 file
 * @param config - Optional audio extraction configuration
 * @returns Promise resolving to output file path
 *
 * @example
 * ```typescript
 * const audioPath = await extractAudioForWhisper(
 *   '/tmp/video.mp4',
 *   '/tmp/audio.mp3'
 * );
 * ```
 */
export async function extractAudioForWhisper(
  videoPath: string,
  outputPath: string,
  config: AudioExtractionConfig = {}
): Promise<string> {
  // Validate file paths (security)
  validateFilePath(videoPath);
  validateFilePath(outputPath);

  const finalConfig = { ...DEFAULT_CONFIG, ...config };

  console.log(`[AudioExtractor] Starting audio extraction from ${path.basename(videoPath)}`);
  console.log(`[AudioExtractor] Config:`, finalConfig);

  // Validate input file exists
  try {
    await fs.access(videoPath);
  } catch (error) {
    throw new Error(`Input video file not found: ${videoPath}`);
  }

  const TIMEOUT_MS = TIMEOUTS.AUDIO_EXTRACTION;

  return new Promise((resolve, reject) => {
    let command = ffmpeg(videoPath);
    let isTimedOut = false;
    let lastProgressLog = 0; // Track last progress log time to avoid spam

    // Timeout handler
    const timeoutId = setTimeout(() => {
      isTimedOut = true;
      console.error(`[AudioExtractor] ✗ Process timed out after ${TIMEOUT_MS / 1000}s (${getTimeoutMinutes(TIMEOUT_MS)} minutes)`);
      try {
        command.kill('SIGKILL');
      } catch (killError) {
        console.error(`[AudioExtractor] Failed to kill FFmpeg process:`, killError);
      }
      reject(new Error(`Audio extraction timed out after ${TIMEOUT_MS}ms`));
    }, TIMEOUT_MS);

    // Set audio codec to MP3
    command = command.audioCodec('libmp3lame');

    // Set sample rate (16kHz for Whisper)
    command = command.audioFrequency(finalConfig.sampleRate);

    // Set channels (mono for speech)
    command = command.audioChannels(finalConfig.channels);

    // Set bitrate
    command = command.audioBitrate(finalConfig.bitrate);

    // Apply audio filters for Whisper optimization
    const filters: string[] = [];

    // ❌ DISABLED: Noise reduction filters conflict with preprocessAudioForVAD
    // The preprocessAudioForVAD function applies comprehensive filtering (80-8000Hz)
    // before VAD processing. If we apply narrow band-pass here (200-3000Hz),
    // the subsequent preprocessing becomes ineffective.
    //
    // Processing order: extractAudioForWhisper → preprocessAudioForVAD → VAD → Whisper
    // Therefore, we only apply basic volume normalization here.
    //
    // if (finalConfig.noiseReduction) {
    //   // High-pass filter: Remove low-frequency noise (< 200 Hz)
    //   filters.push('highpass=f=200');
    //
    //   // Low-pass filter: Remove high-frequency noise (> 3000 Hz)
    //   // Speech is typically 80-3000 Hz
    //   filters.push('lowpass=f=3000');
    // }

    if (finalConfig.volumeNormalization) {
      // Normalize audio volume
      // dynaudnorm: Dynamic Audio Normalizer for consistent levels
      filters.push('dynaudnorm=f=150:g=15');
    }

    if (filters.length > 0) {
      command = command.audioFilters(filters);
    }

    // Set output format and path
    command = command
      .format('mp3')
      .output(outputPath);

    // Progress logging
    command.on('start', (commandLine) => {
      console.log(`[AudioExtractor] FFmpeg command: ${commandLine}`);
      console.log(`[AudioExtractor] Starting audio extraction (timeout: ${getTimeoutMinutes(TIMEOUT_MS)} minutes)...`);
    });

    command.on('progress', (progress) => {
      // Note: fluent-ffmpeg's progress event may not fire reliably
      // We also parse stderr for progress info (see stderr handler below)
      if (progress.percent) {
        const now = Date.now();
        // Log every 10 seconds to avoid spam
        if (now - lastProgressLog >= 10000) {
          console.log(`[AudioExtractor] Progress: ${progress.percent.toFixed(1)}% (timemark: ${progress.timemark || 'unknown'})`);
          lastProgressLog = now;
        }
      }
    });

    command.on('stderr', (stderrLine: string) => {
      // Parse FFmpeg stderr for progress info (more reliable than 'progress' event)
      // FFmpeg outputs lines like: "time=00:01:23.45 bitrate= 128.0kbits/s speed=1.00x"
      const timeMatch = stderrLine.match(/time=(\d{2}):(\d{2}):(\d{2}\.\d{2})/);
      if (timeMatch) {
        const now = Date.now();
        // Log every 30 seconds to avoid spam
        if (now - lastProgressLog >= 30000) {
          const hours = parseInt(timeMatch[1], 10);
          const minutes = parseInt(timeMatch[2], 10);
          const seconds = parseFloat(timeMatch[3]);
          const totalSeconds = hours * 3600 + minutes * 60 + seconds;
          console.log(`[AudioExtractor] Processing: ${totalSeconds.toFixed(1)}s processed`);
          lastProgressLog = now;
        }
      }
    });

    command.on('end', () => {
      if (!isTimedOut) {
        clearTimeout(timeoutId);
        console.log(`[AudioExtractor] ✓ Audio extraction complete: ${path.basename(outputPath)}`);
        resolve(outputPath);
      }
    });

    command.on('error', (error, stdout, stderr) => {
      clearTimeout(timeoutId);
      if (!isTimedOut) {
        console.error(`[AudioExtractor] ✗ FFmpeg error:`, error.message);
        console.error(`[AudioExtractor] stderr (last 500 chars):`, stderr?.slice(-500) || 'none');
        reject(new Error(`Audio extraction failed: ${error.message}`));
      }
    });

    // Start processing
    command.run();
  });
}

/**
 * Get audio metadata from video file
 *
 * @param videoPath - Path to video file
 * @returns Promise resolving to audio metadata
 */
export async function getAudioMetadata(videoPath: string): Promise<{
  duration: number;
  sampleRate: number;
  channels: number;
  codec: string;
}> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err) {
        reject(new Error(`Failed to read audio metadata: ${err.message}`));
        return;
      }

      const audioStream = metadata.streams.find(s => s.codec_type === 'audio');

      if (!audioStream) {
        reject(new Error('No audio stream found in video file'));
        return;
      }

      resolve({
        duration: metadata.format.duration || 0,
        sampleRate: typeof audioStream.sample_rate === 'string'
          ? parseInt(audioStream.sample_rate, 10)
          : (audioStream.sample_rate || 0),
        channels: audioStream.channels || 0,
        codec: audioStream.codec_name || 'unknown',
      });
    });
  });
}

/**
 * Check if video file has audio stream
 *
 * @param videoPath - Path to video file
 * @returns Promise resolving to true if audio exists
 */
export async function hasAudioStream(videoPath: string): Promise<boolean> {
  try {
    await getAudioMetadata(videoPath);
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Preprocess audio for improved VAD detection
 *
 * Applies FFmpeg filters to suppress background music (BGM) and enhance human voice.
 * This improves Voice Activity Detection (VAD) accuracy in videos with loud BGM.
 *
 * Filter chain:
 * 1. highpass=f=80: Remove sub-bass (<80Hz) - kick drums, rumble
 * 2. lowpass=f=8000: Remove high-frequency noise (>8kHz) - cymbals, hiss
 * 3. equalizer (60Hz, -15dB): Suppress BGM bass (40-80Hz)
 * 4. equalizer (160Hz, +10dB): Enhance voice fundamentals (80-240Hz)
 * 5. equalizer (3000Hz, +6dB): Enhance voice harmonics (2-4kHz)
 * 6. afftdn: FFT-based noise reduction
 * 7. dynaudnorm: Volume normalization
 *
 * @param audioPath - Path to input audio file (16kHz mono MP3)
 * @param uploadId - Upload ID for logging
 * @returns Promise<void> - Replaces original file with preprocessed audio
 * @throws Error - On preprocessing failure (caller should use original audio as fallback)
 *
 * @example
 * ```typescript
 * try {
 *   await preprocessAudioForVAD('/tmp/audio.mp3', 'upload_123');
 * } catch (error) {
 *   console.warn('Preprocessing failed, using original audio:', error);
 *   // Continue with original audio
 * }
 * ```
 */
export async function preprocessAudioForVAD(
  audioPath: string,
  uploadId: string
): Promise<void> {
  // Validate file path (security)
  validateFilePath(audioPath);

  console.log(`[${uploadId}] [AudioPreprocessing] Starting audio preprocessing for VAD`);

  // Validate input file exists
  try {
    await fs.access(audioPath);
  } catch (error) {
    throw new Error(`Input audio file not found: ${audioPath}`);
  }

  const tempOutputPath = audioPath.replace('.mp3', '_preprocessed.mp3');
  const TIMEOUT_MS = TIMEOUTS.AUDIO_PREPROCESSING;

  // Build filter chain for BGM suppression and voice enhancement
  // 🔧 RELAXED PARAMETERS: Previous settings were too aggressive (removed human voice)
  // Changes from previous version:
  //   - BGM suppression: -15dB → -10dB (less aggressive)
  //   - Voice boost: +10dB → +12dB (stronger emphasis)
  //   - Noise reduction: 20dB → 10dB (preserve more original audio)
  const filterChain = [
    'highpass=f=80',                                          // Remove sub-bass (<80Hz)
    'lowpass=f=8000',                                         // Remove high frequencies (>8kHz)
    'equalizer=f=60:width_type=h:width=40:g=-10',            // Suppress BGM bass (40-80Hz, -10dB) ← RELAXED
    'equalizer=f=160:width_type=h:width=160:g=12',           // Enhance voice fundamentals (80-240Hz, +12dB) ← STRONGER
    'equalizer=f=3000:width_type=h:width=2000:g=6',          // Enhance voice harmonics (2-4kHz, +6dB)
    'afftdn=nr=10:nf=-40:tn=1',                              // FFT noise reduction (10dB, -40dB floor) ← RELAXED
    'dynaudnorm=f=150:g=15'                                  // Volume normalization
  ].join(',');

  console.log(`[${uploadId}] [AudioPreprocessing] Filter chain: ${filterChain}`);

  return new Promise((resolve, reject) => {
    let isTimedOut = false;
    let lastProgressLog = 0;

    const command = ffmpeg(audioPath)
      .audioFilters(filterChain)
      .audioCodec('libmp3lame')
      .audioFrequency(16000)  // Keep 16kHz for Whisper compatibility
      .audioChannels(1)       // Keep mono
      .audioBitrate('64k')    // Keep 64k bitrate
      .format('mp3')
      .output(tempOutputPath);

    // Timeout handler
    const timeoutId = setTimeout(() => {
      isTimedOut = true;
      console.error(`[${uploadId}] [AudioPreprocessing] ✗ Process timed out after ${TIMEOUT_MS / 1000}s (${getTimeoutMinutes(TIMEOUT_MS)} minutes)`);
      try {
        command.kill('SIGKILL');
      } catch (killError) {
        console.error(`[${uploadId}] [AudioPreprocessing] Failed to kill FFmpeg process:`, killError);
      }
      reject(new Error(`Audio preprocessing timed out after ${TIMEOUT_MS}ms`));
    }, TIMEOUT_MS);

    command
      .on('start', (commandLine) => {
        console.log(`[${uploadId}] [AudioPreprocessing] FFmpeg command: ${commandLine}`);
        console.log(`[${uploadId}] [AudioPreprocessing] Starting preprocessing (timeout: ${getTimeoutMinutes(TIMEOUT_MS)} minutes)...`);
      })
      .on('progress', (progress) => {
        if (progress.percent) {
          const now = Date.now();
          // Log every 10 seconds to avoid spam
          if (now - lastProgressLog >= 10000) {
            console.log(`[${uploadId}] [AudioPreprocessing] Progress: ${progress.percent.toFixed(1)}%`);
            lastProgressLog = now;
          }
        }
      })
      .on('stderr', (stderrLine: string) => {
        // Parse FFmpeg stderr for progress info
        const timeMatch = stderrLine.match(/time=(\d{2}):(\d{2}):(\d{2}\.\d{2})/);
        if (timeMatch) {
          const now = Date.now();
          // Log every 30 seconds to avoid spam
          if (now - lastProgressLog >= 30000) {
            const hours = parseInt(timeMatch[1], 10);
            const minutes = parseInt(timeMatch[2], 10);
            const seconds = parseFloat(timeMatch[3]);
            const totalSeconds = hours * 3600 + minutes * 60 + seconds;
            console.log(`[${uploadId}] [AudioPreprocessing] Processing: ${totalSeconds.toFixed(1)}s processed`);
            lastProgressLog = now;
          }
        }
      })
      .on('end', async () => {
        if (!isTimedOut) {
          clearTimeout(timeoutId);

          try {
            // Get file sizes for logging
            const originalStats = await fs.stat(audioPath);
            const preprocessedStats = await fs.stat(tempOutputPath);

            console.log(`[${uploadId}] [AudioPreprocessing] ✓ Preprocessing complete`);
            console.log(`[${uploadId}] [AudioPreprocessing] Original: ${(originalStats.size / 1024).toFixed(1)}KB`);
            console.log(`[${uploadId}] [AudioPreprocessing] Preprocessed: ${(preprocessedStats.size / 1024).toFixed(1)}KB`);

            // Replace original file with preprocessed version
            await fs.unlink(audioPath);
            await fs.rename(tempOutputPath, audioPath);

            console.log(`[${uploadId}] [AudioPreprocessing] ✓ Replaced original audio with preprocessed version`);
            resolve();
          } catch (replaceError) {
            console.error(`[${uploadId}] [AudioPreprocessing] ✗ Failed to replace file:`, replaceError);
            reject(replaceError);
          }
        }
      })
      .on('error', (error, stdout, stderr) => {
        clearTimeout(timeoutId);
        if (!isTimedOut) {
          console.error(`[${uploadId}] [AudioPreprocessing] ✗ FFmpeg error:`, error.message);
          console.error(`[${uploadId}] [AudioPreprocessing] stderr (last 500 chars):`, stderr?.slice(-500) || 'none');
          reject(new Error(`Audio preprocessing failed: ${error.message}`));
        }
      });

    // Start processing
    command.run();
  });
}

/**
 * Extract a specific time range from audio file
 *
 * Used by VAD service to extract voice segments
 *
 * @param inputPath - Source audio file
 * @param outputPath - Destination chunk file
 * @param startTime - Start time in seconds
 * @param duration - Duration in seconds
 * @returns Promise resolving to output file path
 *
 * @example
 * ```typescript
 * await extractAudioChunk(
 *   '/tmp/audio.mp3',
 *   '/tmp/chunk-0001.mp3',
 *   5.2,   // Start at 5.2s
 *   10.0   // Extract 10 seconds
 * );
 * ```
 */
export async function extractAudioChunk(
  inputPath: string,
  outputPath: string,
  startTime: number,
  duration: number
): Promise<string> {
  // Validate file paths (security)
  validateFilePath(inputPath);
  validateFilePath(outputPath);

  console.log(`[AudioExtractor] Extracting chunk: ${startTime}s - ${startTime + duration}s`);

  const TIMEOUT_MS = TIMEOUTS.AUDIO_CHUNK_EXTRACTION;

  return new Promise((resolve, reject) => {
    const command = ffmpeg(inputPath)
      .setStartTime(startTime)
      .setDuration(duration)
      .audioCodec('libmp3lame')
      .audioFrequency(16000)  // Keep 16kHz for Whisper
      .audioChannels(1)       // Keep mono
      .audioBitrate('64k')
      .format('mp3')
      .output(outputPath);

    let isTimedOut = false;

    // Timeout handler
    const timeoutId = setTimeout(() => {
      isTimedOut = true;
      console.error(`[AudioExtractor] ✗ Chunk extraction timed out after ${TIMEOUT_MS}ms`);
      try {
        command.kill('SIGKILL');
      } catch (killError) {
        console.error(`[AudioExtractor] Failed to kill FFmpeg process:`, killError);
      }
      reject(new Error(`Audio chunk extraction timed out after ${TIMEOUT_MS}ms`));
    }, TIMEOUT_MS);

    command
      .on('end', () => {
        if (!isTimedOut) {
          clearTimeout(timeoutId);
          console.log(`[AudioExtractor] ✓ Chunk extracted: ${path.basename(outputPath)}`);
          resolve(outputPath);
        }
      })
      .on('error', (error) => {
        clearTimeout(timeoutId);
        if (!isTimedOut) {
          console.error(`[AudioExtractor] ✗ Chunk extraction failed:`, error.message);
          reject(new Error(`Failed to extract audio chunk: ${error.message}`));
        }
      })
      .run();
  });
}
