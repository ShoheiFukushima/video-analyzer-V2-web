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
export function formatTimecode(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}
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
export function parseTimecode(timecode) {
    const parts = timecode.split(':').map(Number);
    if (parts.length !== 3) {
        throw new Error(`Invalid timecode format: ${timecode}. Expected HH:MM:SS`);
    }
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
}
/**
 * Format seconds to human-readable duration
 * @param seconds - Time in seconds
 * @returns Human-readable string (e.g., "2m 30s")
 *
 * @example
 * formatDuration(65) // "1m 5s"
 * formatDuration(3661) // "1h 1m 1s"
 */
export function formatDuration(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const parts = [];
    if (h > 0)
        parts.push(`${h}h`);
    if (m > 0)
        parts.push(`${m}m`);
    if (s > 0 || parts.length === 0)
        parts.push(`${s}s`);
    return parts.join(' ');
}
//# sourceMappingURL=timecode.js.map