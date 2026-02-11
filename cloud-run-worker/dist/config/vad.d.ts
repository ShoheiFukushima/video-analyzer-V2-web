/**
 * VAD (Voice Activity Detection) Configuration
 *
 * Centralized configuration for VAD parameters used across the application.
 * Optimized for Whisper API cost savings while maintaining accuracy.
 *
 * Key Metrics:
 * - Cost reduction: 40-60% (vs processing full audio)
 * - Whisper API cost: $0.006/minute
 *
 * Last updated: 2025-11-12
 */
export interface VADConfig {
    /** Maximum chunk duration in seconds (default: 10) */
    maxChunkDuration?: number;
    /** Minimum speech duration to keep in seconds (default: 0.25) */
    minSpeechDuration?: number;
    /** VAD sensitivity (0-1, higher = more sensitive, default: 0.5) */
    sensitivity?: number;
}
/**
 * Default VAD configuration
 *
 * IMPORTANT: These values have been optimized through testing.
 * DO NOT modify without consulting the performance report.
 *
 * Reference: .serena/memories/narration_detection_issue_root_cause_2025-11-12.md
 */
export declare const DEFAULT_VAD_CONFIG: Required<VADConfig>;
/**
 * Whisper API cost constants
 *
 * Reference: https://platform.openai.com/docs/api-reference/audio
 */
export declare const WHISPER_COST: {
    /** Cost per minute of audio (USD) */
    readonly PER_MINUTE: 0.006;
};
/**
 * Pre-chunking configuration for long audio files
 *
 * Problem solved:
 * - Long audio (2+ hours) causes "Maximum call stack size exceeded" in VAD
 * - avr-vad NonRealTimeVAD loads entire audio into memory (460MB for 2 hours)
 * - Spread operator in Math.max(...segments) overflows with 10,000+ segments
 *
 * Solution:
 * - Split audio into smaller chunks BEFORE VAD processing
 * - Process each chunk independently (memory efficient)
 * - Merge results with proper timestamp adjustment
 *
 * Added: 2025-01-18
 */
export interface PreChunkConfig {
    /** Enable pre-chunking for long audio files */
    enabled: boolean;
    /** Chunk duration in seconds (default: 300 = 5 minutes) */
    chunkDuration: number;
    /** Overlap duration in seconds for boundary detection (default: 1) */
    overlapDuration: number;
    /** Minimum audio duration to trigger chunking in seconds (default: 600 = 10 minutes) */
    minDurationForChunking: number;
}
export declare const DEFAULT_PRE_CHUNK_CONFIG: PreChunkConfig;
/**
 * Merge user config with defaults
 *
 * @param config - User-provided partial configuration
 * @returns Complete VAD configuration
 *
 * @example
 * ```typescript
 * const config = getVADConfig({ sensitivity: 0.7 });
 * // Returns: { maxChunkDuration: 10, minSpeechDuration: 0.25, sensitivity: 0.7 }
 * ```
 */
export declare function getVADConfig(config?: VADConfig): Required<VADConfig>;
//# sourceMappingURL=vad.d.ts.map