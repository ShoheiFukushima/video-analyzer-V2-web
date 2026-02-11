import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs/promises';
import { validateFilePath } from '../utils/security.js';
import { TIMEOUTS, getTimeoutMinutes } from '../config/timeouts.js';
import { DEFAULT_PRE_CHUNK_CONFIG } from '../config/vad.js';
const DEFAULT_CONFIG = {
    sampleRate: 16000, // 16kHz recommended by OpenAI
    channels: 1, // Mono for speech
    noiseReduction: true,
    volumeNormalization: true,
    bitrate: '64k', // Sufficient for speech
};
/**
 * gVisor-compatible environment for FFmpeg
 * Disables fontconfig and other features that cause hangs
 */
function getGVisorEnv() {
    return {
        ...process.env,
        FONTCONFIG_PATH: '',
        FONTCONFIG_FILE: '/dev/null',
        FC_DEBUG: '0',
        HOME: '/tmp',
        XDG_CACHE_HOME: '/tmp',
        XDG_CONFIG_HOME: '/tmp',
        FFREPORT: '',
        AV_LOG_FORCE_NOCOLOR: '1',
    };
}
/**
 * Extract audio from video file optimized for Whisper transcription
 * Uses spawn directly for gVisor compatibility
 *
 * @param videoPath - Path to input video file
 * @param outputPath - Path to output MP3 file
 * @param config - Optional audio extraction configuration
 * @returns Promise resolving to output file path
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
    const TIMEOUT_MS = TIMEOUTS.AUDIO_EXTRACTION;
    return new Promise((resolve, reject) => {
        let completed = false;
        let lastActivityTime = Date.now();
        let lastProgressLog = 0;
        // Build audio filters
        const filters = [];
        if (finalConfig.volumeNormalization) {
            filters.push('dynaudnorm=f=150:g=15');
        }
        // Build FFmpeg arguments
        const ffmpegArgs = [
            '-nostdin',
            '-y',
            '-i', videoPath,
            '-vn', // No video
            '-acodec', 'libmp3lame',
            '-ar', finalConfig.sampleRate.toString(),
            '-ac', finalConfig.channels.toString(),
            '-b:a', finalConfig.bitrate,
        ];
        if (filters.length > 0) {
            ffmpegArgs.push('-af', filters.join(','));
        }
        ffmpegArgs.push('-f', 'mp3', outputPath);
        console.log(`[AudioExtractor] FFmpeg command: ffmpeg ${ffmpegArgs.slice(0, 10).join(' ')}...`);
        console.log(`[AudioExtractor] Starting audio extraction (timeout: ${getTimeoutMinutes(TIMEOUT_MS)} minutes)...`);
        const proc = spawn('ffmpeg', ffmpegArgs, {
            env: getGVisorEnv(),
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        // Timeout handler
        const timeoutId = setTimeout(() => {
            if (!completed) {
                completed = true;
                console.error(`[AudioExtractor] ✗ Process timed out after ${TIMEOUT_MS / 1000}s (${getTimeoutMinutes(TIMEOUT_MS)} minutes)`);
                proc.kill('SIGKILL');
                reject(new Error(`Audio extraction timed out after ${TIMEOUT_MS}ms`));
            }
        }, TIMEOUT_MS);
        // Activity watchdog - kill if no output for 60 seconds
        const activityInterval = setInterval(() => {
            const idleTime = Date.now() - lastActivityTime;
            if (idleTime > 60000) {
                if (!completed) {
                    completed = true;
                    console.error(`[AudioExtractor] ✗ FFmpeg idle for ${idleTime / 1000}s - killing process`);
                    clearTimeout(timeoutId);
                    clearInterval(activityInterval);
                    proc.kill('SIGKILL');
                    reject(new Error(`Audio extraction stalled (no output for ${idleTime / 1000}s)`));
                }
            }
        }, 10000);
        proc.stdout?.on('data', () => {
            lastActivityTime = Date.now();
        });
        proc.stderr?.on('data', (data) => {
            lastActivityTime = Date.now();
            const line = data.toString();
            // Parse FFmpeg stderr for progress info
            const timeMatch = line.match(/time=(\d{2}):(\d{2}):(\d{2}\.\d{2})/);
            if (timeMatch) {
                const now = Date.now();
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
        proc.on('close', (code, signal) => {
            if (completed)
                return;
            completed = true;
            clearTimeout(timeoutId);
            clearInterval(activityInterval);
            if (code === 0 || code === null) {
                console.log(`[AudioExtractor] ✓ Audio extraction complete: ${path.basename(outputPath)}`);
                resolve(outputPath);
            }
            else {
                console.error(`[AudioExtractor] ✗ FFmpeg exited with code ${code}, signal ${signal}`);
                reject(new Error(`Audio extraction failed with code ${code}`));
            }
        });
        proc.on('error', (err) => {
            if (completed)
                return;
            completed = true;
            clearTimeout(timeoutId);
            clearInterval(activityInterval);
            console.error(`[AudioExtractor] ✗ FFmpeg spawn error: ${err.message}`);
            reject(new Error(`Audio extraction spawn error: ${err.message}`));
        });
    });
}
/**
 * Get audio metadata from video file using ffprobe
 * Uses spawn directly for gVisor compatibility
 */
export async function getAudioMetadata(videoPath) {
    return new Promise((resolve, reject) => {
        const ffprobeArgs = [
            '-v', 'quiet',
            '-print_format', 'json',
            '-show_streams',
            '-show_format',
            videoPath
        ];
        const proc = spawn('ffprobe', ffprobeArgs, {
            env: getGVisorEnv(),
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        proc.stdout?.on('data', (data) => {
            stdout += data.toString();
        });
        proc.stderr?.on('data', (data) => {
            stderr += data.toString();
        });
        proc.on('close', (code) => {
            if (code !== 0) {
                reject(new Error(`Failed to read audio metadata: ffprobe exited with ${code}`));
                return;
            }
            try {
                const metadata = JSON.parse(stdout);
                const audioStream = metadata.streams?.find((s) => s.codec_type === 'audio');
                if (!audioStream) {
                    reject(new Error('No audio stream found in video file'));
                    return;
                }
                resolve({
                    duration: parseFloat(metadata.format?.duration) || 0,
                    sampleRate: typeof audioStream.sample_rate === 'string'
                        ? parseInt(audioStream.sample_rate, 10)
                        : (audioStream.sample_rate || 0),
                    channels: audioStream.channels || 0,
                    codec: audioStream.codec_name || 'unknown',
                });
            }
            catch (parseError) {
                reject(new Error(`Failed to parse ffprobe output: ${parseError}`));
            }
        });
        proc.on('error', (err) => {
            reject(new Error(`ffprobe spawn error: ${err.message}`));
        });
        // Timeout
        setTimeout(() => {
            proc.kill('SIGKILL');
            reject(new Error('ffprobe timed out'));
        }, 30000);
    });
}
/**
 * Check if video file has audio stream
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
 * Preprocess audio for improved VAD detection
 * Uses spawn directly for gVisor compatibility
 *
 * Applies FFmpeg filters to suppress background music (BGM) and enhance human voice.
 */
export async function preprocessAudioForVAD(audioPath, uploadId) {
    validateFilePath(audioPath);
    console.log(`[${uploadId}] [AudioPreprocessing] Starting audio preprocessing for VAD`);
    try {
        await fs.access(audioPath);
    }
    catch (error) {
        throw new Error(`Input audio file not found: ${audioPath}`);
    }
    const tempOutputPath = audioPath.replace('.mp3', '_preprocessed.mp3');
    const TIMEOUT_MS = TIMEOUTS.AUDIO_PREPROCESSING;
    // Build filter chain for BGM suppression and voice enhancement
    const filterChain = [
        'highpass=f=80',
        'lowpass=f=8000',
        'equalizer=f=60:width_type=h:width=40:g=-10',
        'equalizer=f=160:width_type=h:width=160:g=12',
        'equalizer=f=3000:width_type=h:width=2000:g=6',
        'afftdn=nr=10:nf=-40:tn=1',
        'dynaudnorm=f=150:g=15'
    ].join(',');
    console.log(`[${uploadId}] [AudioPreprocessing] Filter chain: ${filterChain}`);
    return new Promise((resolve, reject) => {
        let completed = false;
        let lastActivityTime = Date.now();
        let lastProgressLog = 0;
        const ffmpegArgs = [
            '-nostdin',
            '-y',
            '-i', audioPath,
            '-af', filterChain,
            '-acodec', 'libmp3lame',
            '-ar', '16000',
            '-ac', '1',
            '-b:a', '64k',
            '-f', 'mp3',
            tempOutputPath
        ];
        console.log(`[${uploadId}] [AudioPreprocessing] Starting preprocessing (timeout: ${getTimeoutMinutes(TIMEOUT_MS)} minutes)...`);
        const proc = spawn('ffmpeg', ffmpegArgs, {
            env: getGVisorEnv(),
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        const timeoutId = setTimeout(() => {
            if (!completed) {
                completed = true;
                console.error(`[${uploadId}] [AudioPreprocessing] ✗ Process timed out after ${TIMEOUT_MS / 1000}s`);
                proc.kill('SIGKILL');
                reject(new Error(`Audio preprocessing timed out after ${TIMEOUT_MS}ms`));
            }
        }, TIMEOUT_MS);
        const activityInterval = setInterval(() => {
            const idleTime = Date.now() - lastActivityTime;
            if (idleTime > 60000) {
                if (!completed) {
                    completed = true;
                    console.error(`[${uploadId}] [AudioPreprocessing] ✗ FFmpeg idle for ${idleTime / 1000}s - killing process`);
                    clearTimeout(timeoutId);
                    clearInterval(activityInterval);
                    proc.kill('SIGKILL');
                    reject(new Error(`Audio preprocessing stalled (no output for ${idleTime / 1000}s)`));
                }
            }
        }, 10000);
        proc.stdout?.on('data', () => {
            lastActivityTime = Date.now();
        });
        proc.stderr?.on('data', (data) => {
            lastActivityTime = Date.now();
            const line = data.toString();
            const timeMatch = line.match(/time=(\d{2}):(\d{2}):(\d{2}\.\d{2})/);
            if (timeMatch) {
                const now = Date.now();
                if (now - lastProgressLog >= 30000) {
                    const hours = parseInt(timeMatch[1], 10);
                    const minutes = parseInt(timeMatch[2], 10);
                    const seconds = parseFloat(timeMatch[3]);
                    const totalSeconds = hours * 3600 + minutes * 60 + seconds;
                    console.log(`[${uploadId}] [AudioPreprocessing] Processing: ${totalSeconds.toFixed(1)}s processed`);
                    lastProgressLog = now;
                }
            }
        });
        proc.on('close', async (code, signal) => {
            if (completed)
                return;
            completed = true;
            clearTimeout(timeoutId);
            clearInterval(activityInterval);
            if (code === 0 || code === null) {
                try {
                    const originalStats = await fs.stat(audioPath);
                    const preprocessedStats = await fs.stat(tempOutputPath);
                    console.log(`[${uploadId}] [AudioPreprocessing] ✓ Preprocessing complete`);
                    console.log(`[${uploadId}] [AudioPreprocessing] Original: ${(originalStats.size / 1024).toFixed(1)}KB`);
                    console.log(`[${uploadId}] [AudioPreprocessing] Preprocessed: ${(preprocessedStats.size / 1024).toFixed(1)}KB`);
                    await fs.unlink(audioPath);
                    await fs.rename(tempOutputPath, audioPath);
                    console.log(`[${uploadId}] [AudioPreprocessing] ✓ Replaced original audio with preprocessed version`);
                    resolve();
                }
                catch (replaceError) {
                    console.error(`[${uploadId}] [AudioPreprocessing] ✗ Failed to replace file:`, replaceError);
                    reject(replaceError);
                }
            }
            else {
                console.error(`[${uploadId}] [AudioPreprocessing] ✗ FFmpeg exited with code ${code}, signal ${signal}`);
                reject(new Error(`Audio preprocessing failed with code ${code}`));
            }
        });
        proc.on('error', (err) => {
            if (completed)
                return;
            completed = true;
            clearTimeout(timeoutId);
            clearInterval(activityInterval);
            console.error(`[${uploadId}] [AudioPreprocessing] ✗ FFmpeg spawn error: ${err.message}`);
            reject(new Error(`Audio preprocessing spawn error: ${err.message}`));
        });
    });
}
/**
 * Extract a specific time range from audio file
 * Uses spawn directly for gVisor compatibility
 */
export async function extractAudioChunk(inputPath, outputPath, startTime, duration) {
    validateFilePath(inputPath);
    validateFilePath(outputPath);
    console.log(`[AudioExtractor] Extracting chunk: ${startTime}s - ${startTime + duration}s`);
    const TIMEOUT_MS = TIMEOUTS.AUDIO_CHUNK_EXTRACTION;
    return new Promise((resolve, reject) => {
        let completed = false;
        let lastActivityTime = Date.now();
        const ffmpegArgs = [
            '-nostdin',
            '-y',
            '-ss', startTime.toString(),
            '-t', duration.toString(),
            '-i', inputPath,
            '-acodec', 'libmp3lame',
            '-ar', '16000',
            '-ac', '1',
            '-b:a', '64k',
            '-f', 'mp3',
            outputPath
        ];
        const proc = spawn('ffmpeg', ffmpegArgs, {
            env: getGVisorEnv(),
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        const timeoutId = setTimeout(() => {
            if (!completed) {
                completed = true;
                console.error(`[AudioExtractor] ✗ Chunk extraction timed out after ${TIMEOUT_MS}ms`);
                proc.kill('SIGKILL');
                reject(new Error(`Audio chunk extraction timed out after ${TIMEOUT_MS}ms`));
            }
        }, TIMEOUT_MS);
        const activityInterval = setInterval(() => {
            const idleTime = Date.now() - lastActivityTime;
            if (idleTime > 30000) { // 30 seconds for chunk extraction
                if (!completed) {
                    completed = true;
                    console.error(`[AudioExtractor] ✗ Chunk extraction idle for ${idleTime / 1000}s`);
                    clearTimeout(timeoutId);
                    clearInterval(activityInterval);
                    proc.kill('SIGKILL');
                    reject(new Error(`Audio chunk extraction stalled (no output for ${idleTime / 1000}s)`));
                }
            }
        }, 5000);
        proc.stdout?.on('data', () => {
            lastActivityTime = Date.now();
        });
        proc.stderr?.on('data', () => {
            lastActivityTime = Date.now();
        });
        proc.on('close', (code) => {
            if (completed)
                return;
            completed = true;
            clearTimeout(timeoutId);
            clearInterval(activityInterval);
            if (code === 0 || code === null) {
                console.log(`[AudioExtractor] ✓ Chunk extracted: ${path.basename(outputPath)}`);
                resolve(outputPath);
            }
            else {
                console.error(`[AudioExtractor] ✗ Chunk extraction failed with code ${code}`);
                reject(new Error(`Failed to extract audio chunk: code ${code}`));
            }
        });
        proc.on('error', (err) => {
            if (completed)
                return;
            completed = true;
            clearTimeout(timeoutId);
            clearInterval(activityInterval);
            console.error(`[AudioExtractor] ✗ Chunk extraction spawn error: ${err.message}`);
            reject(new Error(`Audio chunk extraction spawn error: ${err.message}`));
        });
    });
}
/**
 * Split audio file into smaller chunks for VAD processing
 * Uses spawn directly for gVisor compatibility
 */
export async function splitAudioIntoChunks(audioPath, outputDir, audioDuration, config = DEFAULT_PRE_CHUNK_CONFIG) {
    validateFilePath(audioPath);
    validateFilePath(outputDir);
    if (!config.enabled || audioDuration < config.minDurationForChunking) {
        console.log(`[AudioExtractor] [PreChunk] Chunking not needed (duration: ${audioDuration.toFixed(1)}s, min: ${config.minDurationForChunking}s)`);
        return [];
    }
    console.log(`[AudioExtractor] [PreChunk] ═══════════════════════════════════════`);
    console.log(`[AudioExtractor] [PreChunk] Starting audio pre-chunking`);
    console.log(`[AudioExtractor] [PreChunk] ═══════════════════════════════════════`);
    console.log(`[AudioExtractor] [PreChunk] Audio duration: ${audioDuration.toFixed(1)}s (${(audioDuration / 60).toFixed(1)} minutes)`);
    console.log(`[AudioExtractor] [PreChunk] Chunk duration: ${config.chunkDuration}s (${(config.chunkDuration / 60).toFixed(1)} minutes)`);
    console.log(`[AudioExtractor] [PreChunk] Overlap: ${config.overlapDuration}s`);
    await fs.mkdir(outputDir, { recursive: true });
    const chunks = [];
    let currentStart = 0;
    let chunkIndex = 0;
    while (currentStart < audioDuration) {
        const chunkEnd = Math.min(currentStart + config.chunkDuration + config.overlapDuration, audioDuration);
        const chunkDuration = chunkEnd - currentStart;
        if (chunkDuration < 5) {
            console.log(`[AudioExtractor] [PreChunk] Skipping short final chunk (${chunkDuration.toFixed(1)}s)`);
            break;
        }
        const chunkPath = path.join(outputDir, `prechunk-${chunkIndex.toString().padStart(4, '0')}.mp3`);
        chunks.push({
            index: chunkIndex,
            startTime: currentStart,
            endTime: chunkEnd,
            duration: chunkDuration,
            filePath: chunkPath,
        });
        currentStart += config.chunkDuration;
        chunkIndex++;
    }
    console.log(`[AudioExtractor] [PreChunk] Calculated ${chunks.length} chunks`);
    const TIMEOUT_PER_CHUNK = 60000;
    for (const chunk of chunks) {
        console.log(`[AudioExtractor] [PreChunk] Extracting chunk ${chunk.index + 1}/${chunks.length}: ${chunk.startTime.toFixed(1)}s - ${chunk.endTime.toFixed(1)}s`);
        await new Promise((resolve, reject) => {
            let completed = false;
            let lastActivityTime = Date.now();
            const ffmpegArgs = [
                '-nostdin',
                '-y',
                '-ss', chunk.startTime.toString(),
                '-t', chunk.duration.toString(),
                '-i', audioPath,
                '-acodec', 'libmp3lame',
                '-ar', '16000',
                '-ac', '1',
                '-b:a', '64k',
                '-f', 'mp3',
                chunk.filePath
            ];
            const proc = spawn('ffmpeg', ffmpegArgs, {
                env: getGVisorEnv(),
                stdio: ['ignore', 'pipe', 'pipe'],
            });
            const timeoutId = setTimeout(() => {
                if (!completed) {
                    completed = true;
                    console.error(`[AudioExtractor] [PreChunk] ✗ Chunk ${chunk.index} timed out`);
                    proc.kill('SIGKILL');
                    reject(new Error(`Pre-chunk extraction timed out for chunk ${chunk.index}`));
                }
            }, TIMEOUT_PER_CHUNK);
            const activityInterval = setInterval(() => {
                const idleTime = Date.now() - lastActivityTime;
                if (idleTime > 30000) {
                    if (!completed) {
                        completed = true;
                        clearTimeout(timeoutId);
                        clearInterval(activityInterval);
                        proc.kill('SIGKILL');
                        reject(new Error(`Pre-chunk extraction stalled for chunk ${chunk.index}`));
                    }
                }
            }, 5000);
            proc.stdout?.on('data', () => {
                lastActivityTime = Date.now();
            });
            proc.stderr?.on('data', () => {
                lastActivityTime = Date.now();
            });
            proc.on('close', (code) => {
                if (completed)
                    return;
                completed = true;
                clearTimeout(timeoutId);
                clearInterval(activityInterval);
                if (code === 0 || code === null) {
                    resolve();
                }
                else {
                    reject(new Error(`Pre-chunk extraction failed: code ${code}`));
                }
            });
            proc.on('error', (err) => {
                if (completed)
                    return;
                completed = true;
                clearTimeout(timeoutId);
                clearInterval(activityInterval);
                reject(new Error(`Pre-chunk extraction spawn error: ${err.message}`));
            });
        });
    }
    console.log(`[AudioExtractor] [PreChunk] ✓ All ${chunks.length} chunks extracted`);
    console.log(`[AudioExtractor] [PreChunk] ═══════════════════════════════════════`);
    return chunks;
}
/**
 * Cleanup pre-chunk temporary files
 */
export async function cleanupPreChunks(outputDir) {
    try {
        await fs.rm(outputDir, { recursive: true, force: true });
        console.log(`[AudioExtractor] [PreChunk] ✓ Cleaned up temporary chunks: ${outputDir}`);
    }
    catch (error) {
        console.error(`[AudioExtractor] [PreChunk] Failed to cleanup chunks:`, error);
    }
}
//# sourceMappingURL=audioExtractor.js.map