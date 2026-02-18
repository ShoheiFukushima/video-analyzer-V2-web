/**
 * Timeout Configuration
 *
 * Centralized timeout settings for FFmpeg operations.
 * All values are in milliseconds.
 *
 * Updated: 2026-01-19 - Increased for 2GB video support
 */
/**
 * Timeout constants (milliseconds)
 * Scaled for 2GB video files (~2 hours of HD content)
 */
export declare const TIMEOUTS: {
    /**
     * Audio extraction timeout (20 minutes)
     *
     * Used for: Full audio extraction from video with noise reduction filters
     * Typical duration: 1-5 minutes for 300MB, 10-15 minutes for 2GB
     * Buffer: 1.5x typical duration for safety
     */
    readonly AUDIO_EXTRACTION: 1200000;
    /**
     * Audio chunk extraction timeout (60 seconds)
     *
     * Used for: Extracting small audio segments (10 seconds or less)
     * Typical duration: 0.5-2 seconds
     * Buffer: 30x typical duration for safety (network latency consideration)
     */
    readonly AUDIO_CHUNK_EXTRACTION: 60000;
    /**
     * PCM conversion timeout (5 minutes)
     *
     * Used for: Converting audio to PCM format for VAD processing
     * Typical duration: 10-60 seconds for 300MB, 2-4 minutes for 2GB
     * Buffer: 1.5x typical duration for safety
     */
    readonly PCM_CONVERSION: 300000;
    /**
     * Scene detection timeout (45 minutes)
     *
     * Used for: FFmpeg scene detection with showinfo filter
     * Typical duration: 5-10 minutes for 300MB, 20-40 minutes for 2GB (2+ hours)
     * Buffer: 1.5x typical duration for safety
     * Note: Cloud Run timeout is 1 hour, so this leaves buffer for other operations
     */
    readonly SCENE_DETECTION: 2700000;
    /**
     * Video metadata extraction timeout (60 seconds)
     *
     * Used for: ffprobe metadata extraction
     * Typical duration: 1-5 seconds, up to 30s for 2GB corrupted files
     * Buffer: 2x typical duration for safety
     */
    readonly METADATA_EXTRACTION: 60000;
    /**
     * Audio preprocessing timeout (10 minutes)
     *
     * Used for: BGM suppression and voice enhancement filters for VAD
     * Typical duration: 15-30 seconds for 3-minute video, 3-6 minutes for 2GB
     * Buffer: 1.5x typical duration for safety
     */
    readonly AUDIO_PREPROCESSING: 600000;
    /**
     * Luminance detection timeout (5 minutes)
     *
     * Used for: FFmpeg signalstats luminance analysis (Enhanced mode)
     * Typical duration: 20-60 seconds for 10-minute video, 2-3 minutes for 2GB
     * Buffer: 2x typical duration for safety
     */
    readonly LUMINANCE_DETECTION: 300000;
    /**
     * Text stabilization detection timeout (10 minutes)
     *
     * Used for: Frame extraction and OCR for text stability detection (Enhanced mode)
     * Typical duration: 30-90 seconds, 3-6 minutes for 2GB
     * Buffer: 1.5x typical duration for safety
     */
    readonly TEXT_STABILIZATION: 600000;
    /**
     * R2 chunk download timeout (5 minutes)
     *
     * Used for: Individual chunk download from R2 with Range header
     * Calculation: 50MB chunk at ~100KB/s worst case = 500s, with buffer
     * Note: R2 can be very slow (130 KB/s observed from Cloud Run)
     */
    readonly R2_CHUNK_DOWNLOAD: 300000;
    /**
     * R2 stall detection timeout (45 seconds)
     *
     * Used for: Detecting when stream stops receiving data
     * Typical: Data should flow every few seconds even on slow connections
     * Note: Increased from 30s to accommodate R2 burst behavior
     */
    readonly R2_STALL_DETECTION: 45000;
    /**
     * R2 connection timeout (30 seconds)
     *
     * Used for: Initial TCP/TLS connection establishment
     * Typical: 5-10 seconds, but can be longer for first connection
     * Note: Shortened from 120s for faster failure detection
     */
    readonly R2_CONNECTION: 30000;
    /**
     * R2 socket idle timeout (10 minutes)
     *
     * Used for: Detecting completely idle connections
     * Note: Keep long to allow for slow data transfers
     */
    readonly R2_SOCKET_IDLE: 600000;
    /**
     * R2 Keep-Alive duration (2 minutes)
     *
     * Used for: Reusing TCP connections between requests
     * Note: Longer duration reduces TLS handshake overhead
     */
    readonly R2_KEEP_ALIVE: 120000;
};
/**
 * Get dynamic scene detection timeout based on ROI configuration
 * ROI detection runs multiple passes (full-frame + 4 regions), requiring more time.
 *
 * @returns Timeout in milliseconds
 */
export declare function getSceneDetectionTimeout(): number;
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