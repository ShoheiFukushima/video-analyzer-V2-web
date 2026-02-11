/**
 * Supplementary Scene Detection
 *
 * Detects scene boundaries that TransNet V2 might miss:
 * - Constant luminance sections (≥3 seconds)
 * - Black sections
 * - PAN/motion sections
 *
 * @author Claude Code (Anthropic)
 * @since 2026-01-17
 */
import { spawn } from 'child_process';
// ============================================================
// Configuration
// ============================================================
const DEFAULT_CONFIG = {
    minConstantLuminanceDuration: 3.0,
    luminanceChangeThreshold: 5,
    blackPixelThreshold: 0.10,
    minBlackDuration: 0.5,
    motionSensitivity: 0.5,
};
/**
 * Load supplementary detection configuration from environment
 */
export function loadSupplementaryConfig() {
    return {
        minConstantLuminanceDuration: parseFloat(process.env.SUPPLEMENTARY_MIN_CONSTANT_DURATION || '3.0'),
        luminanceChangeThreshold: parseInt(process.env.SUPPLEMENTARY_LUMINANCE_THRESHOLD || '5', 10),
        blackPixelThreshold: parseFloat(process.env.SUPPLEMENTARY_BLACK_THRESHOLD || '0.10'),
        minBlackDuration: parseFloat(process.env.SUPPLEMENTARY_MIN_BLACK_DURATION || '0.5'),
        motionSensitivity: parseFloat(process.env.SUPPLEMENTARY_MOTION_SENSITIVITY || '0.5'),
    };
}
// ============================================================
// Black Section Detection
// ============================================================
/**
 * Detect black sections in video using FFmpeg blackdetect
 *
 * @param videoPath - Path to the video file
 * @param config - Detection configuration
 * @returns Array of black sections
 */
export async function detectBlackSections(videoPath, config = loadSupplementaryConfig()) {
    return new Promise((resolve, reject) => {
        const sections = [];
        // FFmpeg blackdetect filter
        const args = [
            '-i', videoPath,
            '-vf', `blackdetect=d=${config.minBlackDuration}:pix_th=${config.blackPixelThreshold}`,
            '-an',
            '-f', 'null',
            '-'
        ];
        console.log(`[Supplementary] Running blackdetect: ffmpeg ${args.join(' ')}`);
        const ffmpeg = spawn('ffmpeg', args);
        let stderr = '';
        ffmpeg.stderr.on('data', (data) => {
            stderr += data.toString();
        });
        ffmpeg.on('close', (code) => {
            // Parse blackdetect output
            // Format: [blackdetect @ ...] black_start:10.5 black_end:12.3 black_duration:1.8
            const blackRegex = /black_start:(\d+\.?\d*)\s+black_end:(\d+\.?\d*)\s+black_duration:(\d+\.?\d*)/g;
            let match;
            while ((match = blackRegex.exec(stderr)) !== null) {
                sections.push({
                    startTime: parseFloat(match[1]),
                    endTime: parseFloat(match[2]),
                    duration: parseFloat(match[3]),
                    avgLuminance: 0,
                    type: 'black',
                });
            }
            console.log(`[Supplementary] Detected ${sections.length} black sections`);
            resolve(sections);
        });
        ffmpeg.on('error', (error) => {
            reject(new Error(`FFmpeg blackdetect error: ${error.message}`));
        });
    });
}
/**
 * Analyze luminance values across video frames
 *
 * @param videoPath - Path to the video file
 * @param sampleRate - Frames per second to sample
 * @returns Array of luminance values with timestamps
 */
async function analyzeLuminance(videoPath, sampleRate = 2) {
    return new Promise((resolve, reject) => {
        const frames = [];
        // Use signalstats filter to get luminance (YAVG)
        const args = [
            '-i', videoPath,
            '-vf', `fps=${sampleRate},signalstats,metadata=print:key=lavfi.signalstats.YAVG`,
            '-an',
            '-f', 'null',
            '-'
        ];
        console.log(`[Supplementary] Analyzing luminance at ${sampleRate} FPS`);
        const ffmpeg = spawn('ffmpeg', args);
        let stderr = '';
        ffmpeg.stderr.on('data', (data) => {
            stderr += data.toString();
        });
        ffmpeg.on('close', () => {
            // Parse luminance values
            // Format: lavfi.signalstats.YAVG=123.45
            const lines = stderr.split('\n');
            let frameIndex = 0;
            for (const line of lines) {
                const match = line.match(/lavfi\.signalstats\.YAVG=(\d+\.?\d*)/);
                if (match) {
                    frames.push({
                        timestamp: frameIndex / sampleRate,
                        avgLuminance: parseFloat(match[1]),
                    });
                    frameIndex++;
                }
            }
            console.log(`[Supplementary] Analyzed ${frames.length} frames for luminance`);
            resolve(frames);
        });
        ffmpeg.on('error', (error) => {
            reject(new Error(`FFmpeg luminance analysis error: ${error.message}`));
        });
    });
}
/**
 * Detect constant luminance sections from luminance data
 *
 * @param frames - Luminance frame data
 * @param config - Detection configuration
 * @returns Array of constant luminance sections
 */
function findConstantLuminanceSections(frames, config) {
    if (frames.length < 2)
        return [];
    const sections = [];
    let sectionStart = 0;
    let sectionLuminance = frames[0].avgLuminance;
    for (let i = 1; i < frames.length; i++) {
        const luminanceChange = Math.abs(frames[i].avgLuminance - sectionLuminance);
        if (luminanceChange > config.luminanceChangeThreshold) {
            // End of constant section
            const duration = frames[i - 1].timestamp - frames[sectionStart].timestamp;
            if (duration >= config.minConstantLuminanceDuration) {
                const avgLum = sectionLuminance;
                let type = 'constant';
                if (avgLum < 16)
                    type = 'black';
                else if (avgLum > 240)
                    type = 'white';
                sections.push({
                    startTime: frames[sectionStart].timestamp,
                    endTime: frames[i - 1].timestamp,
                    duration,
                    avgLuminance: avgLum,
                    type,
                });
            }
            // Start new section
            sectionStart = i;
            sectionLuminance = frames[i].avgLuminance;
        }
    }
    // Check final section
    const finalDuration = frames[frames.length - 1].timestamp - frames[sectionStart].timestamp;
    if (finalDuration >= config.minConstantLuminanceDuration) {
        const avgLum = sectionLuminance;
        let type = 'constant';
        if (avgLum < 16)
            type = 'black';
        else if (avgLum > 240)
            type = 'white';
        sections.push({
            startTime: frames[sectionStart].timestamp,
            endTime: frames[frames.length - 1].timestamp,
            duration: finalDuration,
            avgLuminance: avgLum,
            type,
        });
    }
    return sections;
}
/**
 * Detect constant luminance sections in video
 *
 * @param videoPath - Path to the video file
 * @param config - Detection configuration
 * @returns Array of constant luminance sections
 */
export async function detectConstantLuminanceSections(videoPath, config = loadSupplementaryConfig()) {
    const frames = await analyzeLuminance(videoPath, 2);
    const sections = findConstantLuminanceSections(frames, config);
    console.log(`[Supplementary] Detected ${sections.length} constant luminance sections`);
    return sections;
}
// ============================================================
// Motion/PAN Detection
// ============================================================
/**
 * Detect motion/PAN sections using optical flow analysis
 *
 * @param videoPath - Path to the video file
 * @param config - Detection configuration
 * @returns Array of motion sections
 */
export async function detectMotionSections(videoPath, config = loadSupplementaryConfig()) {
    return new Promise((resolve, reject) => {
        const sections = [];
        // Use mpdecimate filter to detect motion changes
        // hi/lo control the detection threshold
        const hi = Math.round(64 * (2 - config.motionSensitivity));
        const lo = Math.round(64 * (1 - config.motionSensitivity * 0.5));
        const args = [
            '-i', videoPath,
            '-vf', `mpdecimate=hi=${hi}:lo=${lo}:frac=0.33,showinfo`,
            '-an',
            '-f', 'null',
            '-'
        ];
        console.log(`[Supplementary] Analyzing motion with mpdecimate (hi=${hi}, lo=${lo})`);
        const ffmpeg = spawn('ffmpeg', args);
        let stderr = '';
        ffmpeg.stderr.on('data', (data) => {
            stderr += data.toString();
        });
        ffmpeg.on('close', () => {
            // Parse showinfo output to find significant motion changes
            // Format: [showinfo] n:123 pts:12345 pts_time:5.123 ...
            const infoRegex = /pts_time:(\d+\.?\d*)/g;
            const timestamps = [];
            let match;
            while ((match = infoRegex.exec(stderr)) !== null) {
                timestamps.push(parseFloat(match[1]));
            }
            // Group consecutive kept frames into motion sections
            // Gaps indicate static sections (many frames dropped)
            if (timestamps.length > 1) {
                let sectionStart = timestamps[0];
                let prevTime = timestamps[0];
                for (let i = 1; i < timestamps.length; i++) {
                    const gap = timestamps[i] - prevTime;
                    // Large gap indicates transition from motion to static
                    if (gap > 1.0) {
                        if (prevTime - sectionStart > 0.5) {
                            sections.push({
                                startTime: sectionStart,
                                endTime: prevTime,
                                duration: prevTime - sectionStart,
                                avgMotion: 0.7, // High motion (frames were kept)
                                type: 'high_motion',
                            });
                        }
                        sectionStart = timestamps[i];
                    }
                    prevTime = timestamps[i];
                }
                // Add final section
                if (prevTime - sectionStart > 0.5) {
                    sections.push({
                        startTime: sectionStart,
                        endTime: prevTime,
                        duration: prevTime - sectionStart,
                        avgMotion: 0.7,
                        type: 'high_motion',
                    });
                }
            }
            console.log(`[Supplementary] Detected ${sections.length} high-motion sections`);
            resolve(sections);
        });
        ffmpeg.on('error', (error) => {
            reject(new Error(`FFmpeg motion detection error: ${error.message}`));
        });
    });
}
// ============================================================
// Combined Detection
// ============================================================
/**
 * Convert luminance sections to scene cuts
 * Scene cuts are placed at section boundaries
 */
function luminanceSectionsToCuts(sections) {
    const cuts = [];
    for (const section of sections) {
        // Add cut at start of constant section
        cuts.push({
            timestamp: section.startTime,
            confidence: 0.7,
            source: 'supplementary',
            detectionReason: `${section.type} section start (avg luminance: ${section.avgLuminance.toFixed(1)})`,
        });
        // Add cut at end of constant section
        cuts.push({
            timestamp: section.endTime,
            confidence: 0.7,
            source: 'supplementary',
            detectionReason: `${section.type} section end`,
        });
    }
    return cuts;
}
/**
 * Convert motion sections to scene cuts
 */
function motionSectionsToCuts(sections) {
    const cuts = [];
    for (const section of sections) {
        // Add cut at start and end of high-motion sections
        cuts.push({
            timestamp: section.startTime,
            confidence: 0.6,
            source: 'supplementary',
            detectionReason: `${section.type} start`,
        });
        cuts.push({
            timestamp: section.endTime,
            confidence: 0.6,
            source: 'supplementary',
            detectionReason: `${section.type} end`,
        });
    }
    return cuts;
}
/**
 * Deduplicate scene cuts by timestamp
 *
 * @param cuts - Array of scene cuts
 * @param threshold - Deduplication threshold in seconds
 * @returns Deduplicated array
 */
function deduplicateCuts(cuts, threshold = 0.5) {
    if (cuts.length === 0)
        return [];
    // Sort by timestamp
    const sorted = [...cuts].sort((a, b) => a.timestamp - b.timestamp);
    const result = [sorted[0]];
    for (let i = 1; i < sorted.length; i++) {
        const lastCut = result[result.length - 1];
        if (sorted[i].timestamp - lastCut.timestamp >= threshold) {
            result.push(sorted[i]);
        }
        else if (sorted[i].confidence > lastCut.confidence) {
            // Keep higher confidence cut
            result[result.length - 1] = sorted[i];
        }
    }
    return result;
}
/**
 * Run all supplementary detection methods
 *
 * @param videoPath - Path to the video file
 * @param config - Detection configuration
 * @returns Combined detection results
 */
export async function detectSupplementarySections(videoPath, config = loadSupplementaryConfig()) {
    const startTime = Date.now();
    console.log('[Supplementary] Starting supplementary detection');
    try {
        // Run all detections in parallel
        const [blackSections, constantSections, motionSections] = await Promise.all([
            detectBlackSections(videoPath, config).catch((err) => {
                console.warn('[Supplementary] Black detection failed:', err.message);
                return [];
            }),
            detectConstantLuminanceSections(videoPath, config).catch((err) => {
                console.warn('[Supplementary] Luminance detection failed:', err.message);
                return [];
            }),
            detectMotionSections(videoPath, config).catch((err) => {
                console.warn('[Supplementary] Motion detection failed:', err.message);
                return [];
            }),
        ]);
        // Combine luminance sections (excluding duplicates from black detection)
        const allLuminanceSections = [
            ...blackSections,
            ...constantSections.filter((c) => !blackSections.some((b) => Math.abs(b.startTime - c.startTime) < 0.5 &&
                Math.abs(b.endTime - c.endTime) < 0.5)),
        ];
        // Convert to scene cuts
        const luminanceCuts = luminanceSectionsToCuts(allLuminanceSections);
        const motionCuts = motionSectionsToCuts(motionSections);
        // Combine and deduplicate
        const allCuts = deduplicateCuts([...luminanceCuts, ...motionCuts]);
        const processingTimeMs = Date.now() - startTime;
        console.log(`[Supplementary] Detection completed: ${allCuts.length} cuts in ${processingTimeMs}ms`);
        console.log(`[Supplementary] - Black sections: ${blackSections.length}`);
        console.log(`[Supplementary] - Constant luminance sections: ${constantSections.length}`);
        console.log(`[Supplementary] - Motion sections: ${motionSections.length}`);
        return {
            cuts: allCuts,
            luminanceSections: allLuminanceSections,
            motionSections,
            processingTimeMs,
        };
    }
    catch (error) {
        const processingTimeMs = Date.now() - startTime;
        console.error(`[Supplementary] Detection failed: ${error}`);
        return {
            cuts: [],
            luminanceSections: [],
            motionSections: [],
            processingTimeMs,
        };
    }
}
// ============================================================
// Integration with TransNet V2
// ============================================================
/**
 * Merge TransNet V2 cuts with supplementary cuts
 *
 * @param transnetCuts - Cuts from TransNet V2
 * @param supplementaryCuts - Cuts from supplementary detection
 * @param deduplicationThreshold - Threshold for deduplication in seconds
 * @returns Merged and deduplicated cuts
 */
export function mergeWithTransNetCuts(transnetCuts, supplementaryCuts, deduplicationThreshold = 0.5) {
    console.log(`[Supplementary] Merging ${transnetCuts.length} TransNet cuts with ${supplementaryCuts.length} supplementary cuts`);
    const allCuts = [...transnetCuts, ...supplementaryCuts];
    const merged = deduplicateCuts(allCuts, deduplicationThreshold);
    console.log(`[Supplementary] Merged result: ${merged.length} cuts`);
    return merged;
}
//# sourceMappingURL=supplementaryDetector.js.map