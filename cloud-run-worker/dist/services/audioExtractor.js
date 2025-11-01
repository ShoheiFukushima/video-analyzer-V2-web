import ffmpeg from 'fluent-ffmpeg';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';
const DEFAULT_CONFIG = {
    sampleRate: 16000, // 16kHz recommended by OpenAI
    channels: 1, // Mono for speech
    noiseReduction: true,
    volumeNormalization: true,
    bitrate: '64k', // Sufficient for speech
};
/**
 * Validate file path to prevent path traversal attacks
 *
 * @param filePath - Path to validate
 * @throws Error if path is outside allowed directory
 */
function validateFilePath(filePath) {
    const normalizedPath = path.resolve(filePath);
    const allowedDir = path.resolve(os.tmpdir());
    if (!normalizedPath.startsWith(allowedDir)) {
        throw new Error(`Invalid file path: must be within ${allowedDir}. ` +
            `Attempted path: ${normalizedPath}`);
    }
}
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
export async function extractAudioForWhisper(videoPath, outputPath, config = {}) {
    // Validate file paths (security)
    validateFilePath(videoPath);
    validateFilePath(outputPath);
    const finalConfig = { ...DEFAULT_CONFIG, ...config };
    console.log(`[AudioExtractor] Starting audio extraction from ${path.basename(videoPath)}`);
    console.log(`[AudioExtractor] Config:`, finalConfig);
    // Validate input file exists
    try {
        await fs.access(videoPath);
    }
    catch (error) {
        throw new Error(`Input video file not found: ${videoPath}`);
    }
    // Timeout configuration (2 minutes default)
    const TIMEOUT_MS = 120000;
    return new Promise((resolve, reject) => {
        let command = ffmpeg(videoPath);
        let isTimedOut = false;
        // Timeout handler
        const timeoutId = setTimeout(() => {
            isTimedOut = true;
            console.error(`[AudioExtractor] ✗ Process timed out after ${TIMEOUT_MS}ms`);
            try {
                command.kill('SIGKILL');
            }
            catch (killError) {
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
        const filters = [];
        if (finalConfig.noiseReduction) {
            // High-pass filter: Remove low-frequency noise (< 200 Hz)
            filters.push('highpass=f=200');
            // Low-pass filter: Remove high-frequency noise (> 3000 Hz)
            // Speech is typically 80-3000 Hz
            filters.push('lowpass=f=3000');
        }
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
        });
        command.on('progress', (progress) => {
            if (progress.percent) {
                console.log(`[AudioExtractor] Progress: ${progress.percent.toFixed(1)}%`);
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
                console.error(`[AudioExtractor] stderr:`, stderr);
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
export async function getAudioMetadata(videoPath) {
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
export async function hasAudioStream(videoPath) {
    try {
        await getAudioMetadata(videoPath);
        return true;
    }
    catch (error) {
        return false;
    }
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
export async function extractAudioChunk(inputPath, outputPath, startTime, duration) {
    // Validate file paths (security)
    validateFilePath(inputPath);
    validateFilePath(outputPath);
    console.log(`[AudioExtractor] Extracting chunk: ${startTime}s - ${startTime + duration}s`);
    // Timeout configuration (30 seconds for chunks)
    const TIMEOUT_MS = 30000;
    return new Promise((resolve, reject) => {
        const command = ffmpeg(inputPath)
            .setStartTime(startTime)
            .setDuration(duration)
            .audioCodec('libmp3lame')
            .audioFrequency(16000) // Keep 16kHz for Whisper
            .audioChannels(1) // Keep mono
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
            }
            catch (killError) {
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
//# sourceMappingURL=audioExtractor.js.map