/**
 * Timeout Configuration
 *
 * Centralized timeout settings for FFmpeg operations.
 * All values are in milliseconds.
 *
 * Last updated: 2025-11-12
 */
/**
 * Timeout constants (milliseconds)
 */
export declare const TIMEOUTS: {
    /**
     * Audio extraction timeout (10 minutes)
     *
     * Used for: Full audio extraction from video with noise reduction filters
     * Typical duration: 1-5 minutes for 300MB video
     * Buffer: 2x typical duration for safety
     */
    readonly AUDIO_EXTRACTION: 600000;
    /**
     * Audio chunk extraction timeout (30 seconds)
     *
     * Used for: Extracting small audio segments (10 seconds or less)
     * Typical duration: 0.5-2 seconds
     * Buffer: 15x typical duration for safety
     */
    readonly AUDIO_CHUNK_EXTRACTION: 30000;
    /**
     * PCM conversion timeout (2 minutes)
     *
     * Used for: Converting audio to PCM format for VAD processing
     * Typical duration: 10-60 seconds for 300MB video
     * Buffer: 2x typical duration for safety
     */
    readonly PCM_CONVERSION: 120000;
    /**
     * Scene detection timeout (5 minutes)
     *
     * Used for: FFmpeg scene detection with showinfo filter
     * Typical duration: 1-3 minutes for 300MB video
     * Buffer: 2x typical duration for safety
     */
    readonly SCENE_DETECTION: 300000;
    /**
     * Video metadata extraction timeout (30 seconds)
     *
     * Used for: ffprobe metadata extraction
     * Typical duration: 1-5 seconds
     * Buffer: 6x typical duration for safety
     */
    readonly METADATA_EXTRACTION: 30000;
    /**
     * Audio preprocessing timeout (5 minutes)
     *
     * Used for: BGM suppression and voice enhancement filters for VAD
     * Typical duration: 15-30 seconds for 3-minute video
     * Buffer: 10x typical duration for safety
     */
    readonly AUDIO_PREPROCESSING: 300000;
    /**
     * Luminance detection timeout (2 minutes)
     *
     * Used for: FFmpeg signalstats luminance analysis (Enhanced mode)
     * Typical duration: 20-60 seconds for 10-minute video
     * Buffer: 2x typical duration for safety
     */
    readonly LUMINANCE_DETECTION: 120000;
    /**
     * Text stabilization detection timeout (3 minutes)
     *
     * Used for: Frame extraction and OCR for text stability detection (Enhanced mode)
     * Typical duration: 30-90 seconds depending on stabilization points
     * Buffer: 2x typical duration for safety
     */
    readonly TEXT_STABILIZATION: 180000;
};
/**
 * Get timeout value in seconds (for logging)
 *
 * @param timeoutMs - Timeout in milliseconds
 * @returns Timeout in seconds
 */
export declare function getTimeoutSeconds(timeoutMs: number): number;
/**
 * Get timeout value in minutes (for logging)
 *
 * @param timeoutMs - Timeout in milliseconds
 * @returns Timeout in minutes
 */
export declare function getTimeoutMinutes(timeoutMs: number): number;
//# sourceMappingURL=timeouts.d.ts.map