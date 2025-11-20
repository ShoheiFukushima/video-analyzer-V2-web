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
export declare function extractAudioForWhisper(videoPath: string, outputPath: string, config?: AudioExtractionConfig): Promise<string>;
/**
 * Get audio metadata from video file
 *
 * @param videoPath - Path to video file
 * @returns Promise resolving to audio metadata
 */
export declare function getAudioMetadata(videoPath: string): Promise<{
    duration: number;
    sampleRate: number;
    channels: number;
    codec: string;
}>;
/**
 * Check if video file has audio stream
 *
 * @param videoPath - Path to video file
 * @returns Promise resolving to true if audio exists
 */
export declare function hasAudioStream(videoPath: string): Promise<boolean>;
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
export declare function preprocessAudioForVAD(audioPath: string, uploadId: string): Promise<void>;
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
export declare function extractAudioChunk(inputPath: string, outputPath: string, startTime: number, duration: number): Promise<string>;
//# sourceMappingURL=audioExtractor.d.ts.map