/**
 * Timecode Utility Functions
 * Convert between seconds and HH:MM:SS format
 */
/**
 * Convert seconds to HH:MM:SS timecode format
 * @param seconds - Time in seconds (can be decimal)
 * @returns Timecode string (e.g., "00:05:23")
 *
 * @example
 * formatTimecode(0) // "00:00:00"
 * formatTimecode(65.5) // "00:01:05"
 * formatTimecode(3661) // "01:01:01"
 */
export declare function formatTimecode(seconds: number): string;
/**
 * Convert HH:MM:SS timecode to seconds
 * @param timecode - Timecode string (e.g., "00:05:23")
 * @returns Time in seconds
 *
 * @example
 * parseTimecode("00:00:00") // 0
 * parseTimecode("00:01:05") // 65
 * parseTimecode("01:01:01") // 3661
 */
export declare function parseTimecode(timecode: string): number;
/**
 * Format seconds to human-readable duration
 * @param seconds - Time in seconds
 * @returns Human-readable string (e.g., "2m 30s")
 *
 * @example
 * formatDuration(65) // "1m 5s"
 * formatDuration(3661) // "1h 1m 1s"
 */
export declare function formatDuration(seconds: number): string;
//# sourceMappingURL=timecode.d.ts.map