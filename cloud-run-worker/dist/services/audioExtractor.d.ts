import { type PreChunkConfig } from '../config/vad.js';
/**
 * Audio Extraction Service optimized for OpenAI Whisper API
 *
 * Rewritten to use spawn directly for Cloud Run gVisor compatibility.
 * fluent-ffmpeg's .run() method can hang in gVisor environment.
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
/**
 * Extract audio from video file optimized for Whisper transcription
 * Uses spawn directly for gVisor compatibility
 *
 * @param videoPath - Path to input video file
 * @param outputPath - Path to output MP3 file
 * @param config - Optional audio extraction configuration
 * @returns Promise resolving to output file path
 */
export declare function extractAudioForWhisper(videoPath: string, outputPath: string, config?: AudioExtractionConfig): Promise<string>;
/**
 * Get audio metadata from video file using ffprobe
 * Uses spawn directly for gVisor compatibility
 */
export declare function getAudioMetadata(videoPath: string): Promise<{
    duration: number;
    sampleRate: number;
    channels: number;
    codec: string;
}>;
/**
 * Check if video file has audio stream
 */
export declare function hasAudioStream(videoPath: string): Promise<boolean>;
/**
 * Preprocess audio for improved VAD detection
 * Uses spawn directly for gVisor compatibility
 *
 * Applies FFmpeg filters to suppress background music (BGM) and enhance human voice.
 */
export declare function preprocessAudioForVAD(audioPath: string, uploadId: string): Promise<void>;
/**
 * Extract a specific time range from audio file
 * Uses spawn directly for gVisor compatibility
 */
export declare function extractAudioChunk(inputPath: string, outputPath: string, startTime: number, duration: number): Promise<string>;
/**
 * Audio file chunk metadata for pre-chunking long audio files
 */
export interface AudioFileChunk {
    index: number;
    startTime: number;
    endTime: number;
    duration: number;
    filePath: string;
}
/**
 * Split audio file into smaller chunks for VAD processing
 * Uses spawn directly for gVisor compatibility
 */
export declare function splitAudioIntoChunks(audioPath: string, outputDir: string, audioDuration: number, config?: PreChunkConfig): Promise<AudioFileChunk[]>;
/**
 * Cleanup pre-chunk temporary files
 */
export declare function cleanupPreChunks(outputDir: string): Promise<void>;
//# sourceMappingURL=audioExtractor.d.ts.map