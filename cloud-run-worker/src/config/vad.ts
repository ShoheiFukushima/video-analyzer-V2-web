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
export const DEFAULT_VAD_CONFIG: Required<VADConfig> = {
  /**
   * Maximum chunk duration (10 seconds)
   *
   * Why 10 seconds:
   * - Whisper API optimal chunk size
   * - Balances accuracy and processing time
   * - Prevents context loss in long segments
   */
  maxChunkDuration: 10,

  /**
   * Minimum speech duration (0.10 seconds)
   *
   * Why 0.10 seconds (Updated 2025-11-12):
   * - Allows VAD to capture very brief speech segments
   * - Prevents pathological "everything filtered out" scenario
   * - Still discards ultra-short spikes (<0.10s = VAD sampling window)
   * - Trade-off: More segments processed, but prevents zero-detection failures
   *
   * History:
   * - 0.25s: Original conservative setting
   * - 0.15s: More aggressive (but still filtered out BGM-only videos)
   * - 0.10s: Current (matches VAD minimum detection unit)
   */
  minSpeechDuration: 0.10,

  /**
   * VAD sensitivity (0.3 = moderate detection)
   *
   * Why 0.3 (Updated 2025-11-12):
   * - Moderate detection reduces BGM false positives
   * - Previous 0.2 (very aggressive) detected 31k+ micro-segments in BGM-only video
   * - Higher threshold = fewer false positives from music beats/transients
   * - Trade-off: May miss very quiet speech, but fallback mechanism compensates
   *
   * Range:
   * - 0.2: Very aggressive (picks up BGM beats) ← PREVIOUS (too sensitive)
   * - 0.3: Moderate (current) ← CURRENT (balanced)
   * - 0.5: Balanced (default)
   * - 0.7-0.9: Conservative (may miss quiet speech)
   */
  sensitivity: 0.3,
};

/**
 * Whisper API cost constants
 *
 * Reference: https://platform.openai.com/docs/api-reference/audio
 */
export const WHISPER_COST = {
  /** Cost per minute of audio (USD) */
  PER_MINUTE: 0.006,
} as const;

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

export const DEFAULT_PRE_CHUNK_CONFIG: PreChunkConfig = {
  /**
   * Enable pre-chunking
   *
   * When enabled, audio files longer than minDurationForChunking
   * will be split into chunks before VAD processing.
   */
  enabled: true,

  /**
   * Chunk duration (5 minutes = 300 seconds)
   *
   * Why 5 minutes:
   * - Memory: 38MB per chunk (vs 460MB for 2-hour audio)
   * - VAD processes efficiently (1000-5000 segments per chunk)
   * - Balances processing overhead vs memory efficiency
   */
  chunkDuration: 300,

  /**
   * Overlap duration (1 second)
   *
   * Why 1 second:
   * - Prevents missing speech at chunk boundaries
   * - Minimal processing overhead
   * - Duplicate segments removed during merge
   */
  overlapDuration: 1,

  /**
   * Minimum duration for chunking (10 minutes = 600 seconds)
   *
   * Why 10 minutes:
   * - Short videos don't need chunking overhead
   * - 10-minute audio = 77MB in memory (acceptable)
   * - Only long documentaries/videos trigger chunking
   */
  minDurationForChunking: 600,
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
export function getVADConfig(config: VADConfig = {}): Required<VADConfig> {
  return {
    ...DEFAULT_VAD_CONFIG,
    ...config,
  };
}
