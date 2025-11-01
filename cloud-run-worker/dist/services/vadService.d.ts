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
export declare function processAudioWithVAD(audioPath: string, outputDir: string, config?: VADConfig): Promise<VADResult>;
/**
 * Extract audio chunk from original file using ffmpeg
 *
 * @param audioPath - Original audio file
 * @param chunk - Chunk metadata
 * @returns Path to extracted chunk file
 */
export declare function extractAudioChunk(audioPath: string, chunk: AudioChunk): Promise<string>;
/**
 * Cleanup VAD temporary files
 *
 * @param outputDir - Directory containing chunk files
 */
export declare function cleanupVADFiles(outputDir: string): Promise<void>;
//# sourceMappingURL=vadService.d.ts.map