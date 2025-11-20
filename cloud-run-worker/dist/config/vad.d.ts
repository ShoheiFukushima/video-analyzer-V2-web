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