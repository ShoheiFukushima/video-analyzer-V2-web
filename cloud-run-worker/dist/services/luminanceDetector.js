/**
 * Luminance-Based Scene Detection
 *
 * Detects video transitions that standard scene detection misses:
 * - Fade in/out (black or white)
 * - Dissolve transitions
 * - Flash effects
 *
 * Uses FFmpeg signalstats filter to track average luminance (YAVG)
 *
 * @module luminanceDetector
 */
import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
const execFileAsync = promisify(execFile);
// ========================================
// Constants
// ========================================
const DEFAULT_CONFIG = {
    sampleFps: 10,
    whiteThreshold: 230,
    blackThreshold: 25,
    stabilityThreshold: 0.03, // 3% change
    stabilityDuration: 0.3, // 0.3 seconds
    minWhiteDuration: 0.5 // 0.5 seconds
};
const LUMINANCE_DETECTION_TIMEOUT = 120000; // 2 minutes
// ========================================
// Main Detection Functions
// ========================================
/**
 * Extract luminance data from video using FFmpeg signalstats
 *
 * @param videoPath - Path to video file
 * @param config - Detection configuration
 * @returns Array of luminance samples with timestamps
 */
export async function extractLuminanceData(videoPath, config = {}) {
    const fullConfig = { ...DEFAULT_CONFIG, ...config };
    console.log('  Luminance Detection: Starting FFmpeg signalstats analysis...');
    console.log(`    Config: fps=${fullConfig.sampleFps}, whiteThreshold=${fullConfig.whiteThreshold}`);
    return new Promise((resolve, reject) => {
        const samples = [];
        // FFmpeg command to extract luminance data
        // Output format: frame:N pts:N pts_time:N.NNN lavfi.signalstats.YAVG=N.NNN
        const ffmpegArgs = [
            '-i', videoPath,
            '-vf', `fps=${fullConfig.sampleFps},format=gray,signalstats=stat=lavfi.signalstats.YAVG,metadata=mode=print`,
            '-f', 'null',
            '-'
        ];
        const ffmpeg = spawn('ffmpeg', ffmpegArgs, {
            stdio: ['pipe', 'pipe', 'pipe']
        });
        let stderr = '';
        let currentTimestamp = 0;
        ffmpeg.stderr.on('data', (data) => {
            stderr += data.toString();
            // Parse real-time output for luminance data
            const lines = stderr.split('\n');
            stderr = lines.pop() || ''; // Keep incomplete line
            for (const line of lines) {
                // Match pts_time
                const timeMatch = line.match(/pts_time:(\d+\.?\d*)/);
                if (timeMatch) {
                    currentTimestamp = parseFloat(timeMatch[1]);
                }
                // Match YAVG (average luminance)
                const yavgMatch = line.match(/YAVG=(\d+\.?\d*)/);
                if (yavgMatch && currentTimestamp > 0) {
                    samples.push({
                        timestamp: currentTimestamp,
                        luminance: parseFloat(yavgMatch[1])
                    });
                }
            }
        });
        // Set timeout
        const timeout = setTimeout(() => {
            ffmpeg.kill('SIGKILL');
            reject(new Error(`Luminance detection timed out after ${LUMINANCE_DETECTION_TIMEOUT / 1000}s`));
        }, LUMINANCE_DETECTION_TIMEOUT);
        ffmpeg.on('close', (code) => {
            clearTimeout(timeout);
            if (code !== 0 && samples.length === 0) {
                reject(new Error(`FFmpeg signalstats failed with code ${code}`));
                return;
            }
            // Sort by timestamp and remove duplicates
            const sortedSamples = samples
                .sort((a, b) => a.timestamp - b.timestamp)
                .filter((sample, index, arr) => {
                if (index === 0)
                    return true;
                return sample.timestamp !== arr[index - 1].timestamp;
            });
            console.log(`    Extracted ${sortedSamples.length} luminance samples`);
            resolve(sortedSamples);
        });
        ffmpeg.on('error', (err) => {
            clearTimeout(timeout);
            reject(err);
        });
    });
}
/**
 * Detect white screen intervals in luminance data
 *
 * @param samples - Array of luminance samples
 * @param config - Detection configuration
 * @returns Array of white screen intervals with start/end times
 */
export function detectWhiteScreenIntervals(samples, config = {}) {
    const fullConfig = { ...DEFAULT_CONFIG, ...config };
    const intervals = [];
    if (samples.length === 0)
        return intervals;
    let intervalStart = null;
    let intervalSamples = [];
    for (const sample of samples) {
        const isWhite = sample.luminance >= fullConfig.whiteThreshold;
        if (isWhite) {
            if (intervalStart === null) {
                intervalStart = sample.timestamp;
                intervalSamples = [sample];
            }
            else {
                intervalSamples.push(sample);
            }
        }
        else {
            if (intervalStart !== null) {
                const duration = sample.timestamp - intervalStart;
                // Only record if duration meets minimum threshold
                if (duration >= fullConfig.minWhiteDuration) {
                    const avgLuminance = intervalSamples.reduce((sum, s) => sum + s.luminance, 0) / intervalSamples.length;
                    intervals.push({
                        start: intervalStart,
                        end: sample.timestamp,
                        avgLuminance
                    });
                }
                intervalStart = null;
                intervalSamples = [];
            }
        }
    }
    // Handle case where video ends on white screen
    if (intervalStart !== null && intervalSamples.length > 0) {
        const lastSample = samples[samples.length - 1];
        const duration = lastSample.timestamp - intervalStart;
        if (duration >= fullConfig.minWhiteDuration) {
            const avgLuminance = intervalSamples.reduce((sum, s) => sum + s.luminance, 0) / intervalSamples.length;
            intervals.push({
                start: intervalStart,
                end: lastSample.timestamp,
                avgLuminance
            });
        }
    }
    console.log(`    Detected ${intervals.length} white screen intervals`);
    return intervals;
}
/**
 * Detect black screen intervals in luminance data
 *
 * @param samples - Array of luminance samples
 * @param config - Detection configuration
 * @returns Array of black screen intervals with start/end times
 */
export function detectBlackScreenIntervals(samples, config = {}) {
    const fullConfig = { ...DEFAULT_CONFIG, ...config };
    const intervals = [];
    if (samples.length === 0)
        return intervals;
    let intervalStart = null;
    let intervalSamples = [];
    for (const sample of samples) {
        const isBlack = sample.luminance <= fullConfig.blackThreshold;
        if (isBlack) {
            if (intervalStart === null) {
                intervalStart = sample.timestamp;
                intervalSamples = [sample];
            }
            else {
                intervalSamples.push(sample);
            }
        }
        else {
            if (intervalStart !== null) {
                const duration = sample.timestamp - intervalStart;
                if (duration >= fullConfig.minWhiteDuration) {
                    const avgLuminance = intervalSamples.reduce((sum, s) => sum + s.luminance, 0) / intervalSamples.length;
                    intervals.push({
                        start: intervalStart,
                        end: sample.timestamp,
                        avgLuminance
                    });
                }
                intervalStart = null;
                intervalSamples = [];
            }
        }
    }
    // Handle case where video ends on black screen
    if (intervalStart !== null && intervalSamples.length > 0) {
        const lastSample = samples[samples.length - 1];
        const duration = lastSample.timestamp - intervalStart;
        if (duration >= fullConfig.minWhiteDuration) {
            const avgLuminance = intervalSamples.reduce((sum, s) => sum + s.luminance, 0) / intervalSamples.length;
            intervals.push({
                start: intervalStart,
                end: lastSample.timestamp,
                avgLuminance
            });
        }
    }
    console.log(`    Detected ${intervals.length} black screen intervals`);
    return intervals;
}
/**
 * Detect stabilization points after white/black screen intervals
 *
 * A stabilization point is where the luminance stops changing significantly,
 * indicating that a fade/dissolve transition has completed.
 *
 * @param samples - Array of luminance samples
 * @param intervals - Array of white or black screen intervals
 * @param type - Type of interval ('from_white' or 'from_black')
 * @param config - Detection configuration
 * @returns Array of stabilization points
 */
export function detectStabilizationPoints(samples, intervals, type, config = {}) {
    const fullConfig = { ...DEFAULT_CONFIG, ...config };
    const points = [];
    const sampleInterval = 1 / fullConfig.sampleFps;
    const windowSamples = Math.ceil(fullConfig.stabilityDuration / sampleInterval);
    for (const interval of intervals) {
        // Find samples after the interval ends
        const afterIntervalSamples = samples.filter(s => s.timestamp > interval.end &&
            s.timestamp < interval.end + 2 // Look within 2 seconds after interval
        );
        if (afterIntervalSamples.length < windowSamples)
            continue;
        // Find the point where luminance stabilizes
        for (let i = windowSamples; i < afterIntervalSamples.length; i++) {
            const window = afterIntervalSamples.slice(i - windowSamples, i);
            // Calculate luminance variance in window
            const avgLuminance = window.reduce((sum, s) => sum + s.luminance, 0) / window.length;
            const maxVariation = Math.max(...window.map(s => Math.abs(s.luminance - avgLuminance) / 255));
            if (maxVariation <= fullConfig.stabilityThreshold) {
                // Found stabilization point
                const luminanceBefore = interval.avgLuminance;
                const luminanceAfter = avgLuminance;
                const timestamp = window[0].timestamp;
                // Calculate confidence based on luminance change
                const luminanceChange = Math.abs(luminanceAfter - luminanceBefore) / 255;
                const confidence = Math.min(luminanceChange / 0.5, 1); // Max confidence at 50% change
                points.push({
                    timestamp,
                    type,
                    luminanceBefore,
                    luminanceAfter,
                    confidence
                });
                break; // Only one stabilization point per interval
            }
        }
    }
    console.log(`    Detected ${points.length} stabilization points (${type})`);
    return points;
}
/**
 * Run full luminance-based detection pipeline
 *
 * @param videoPath - Path to video file
 * @param config - Detection configuration
 * @returns Object containing all detection results
 */
export async function runLuminanceDetection(videoPath, config = {}) {
    console.log('\n🔦 Running Luminance-Based Detection...');
    // Step 1: Extract luminance data
    const samples = await extractLuminanceData(videoPath, config);
    // Step 2: Detect white and black screen intervals
    const whiteIntervals = detectWhiteScreenIntervals(samples, config);
    const blackIntervals = detectBlackScreenIntervals(samples, config);
    // Step 3: Detect stabilization points
    const whiteStabilizations = detectStabilizationPoints(samples, whiteIntervals, 'from_white', config);
    const blackStabilizations = detectStabilizationPoints(samples, blackIntervals, 'from_black', config);
    const stabilizationPoints = [...whiteStabilizations, ...blackStabilizations]
        .sort((a, b) => a.timestamp - b.timestamp);
    console.log(`\n  📊 Luminance Detection Summary:`);
    console.log(`     Total samples: ${samples.length}`);
    console.log(`     White screen intervals: ${whiteIntervals.length}`);
    console.log(`     Black screen intervals: ${blackIntervals.length}`);
    console.log(`     Stabilization points: ${stabilizationPoints.length}`);
    return {
        samples,
        whiteIntervals,
        blackIntervals,
        stabilizationPoints
    };
}
/**
 * Get stabilization points only (convenience function)
 *
 * @param videoPath - Path to video file
 * @param config - Detection configuration
 * @returns Array of stabilization points
 */
export async function getStabilizationPoints(videoPath, config = {}) {
    const result = await runLuminanceDetection(videoPath, config);
    return result.stabilizationPoints;
}
//# sourceMappingURL=luminanceDetector.js.map