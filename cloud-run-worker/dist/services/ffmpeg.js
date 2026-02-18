/**
 * FFmpeg Scene Detection Service
 * Implements multi-pass scene detection with mid-point frame extraction
 * Based on VideoContentAnalyzer V2's proven algorithm (100% OCR accuracy)
 *
 * Adapted from V1 for V2 architecture with Scene interface
 */
import ffmpeg from 'fluent-ffmpeg';
import { promises as fs } from 'fs';
import path from 'path';
import { spawn, execSync } from 'child_process';
import pLimit from 'p-limit';
import { formatTimecode } from '../utils/timecode.js';
import { TIMEOUTS, getSceneDetectionTimeout } from '../config/timeouts.js';
// Concurrency limit for parallel frame extraction
// Balanced for 4 vCPU Cloud Run instance
const FRAME_EXTRACTION_CONCURRENCY = 10;
/**
 * Format seconds to MM:SS or H:MM:SS format
 */
function formatTimeForProgress(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    if (hours > 0) {
        return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
}
/**
 * Parse FFmpeg time string (HH:MM:SS.ss or MM:SS.ss) to seconds
 */
function parseFFmpegTime(timeStr) {
    const match = timeStr.match(/(\d+):(\d+):(\d+\.?\d*)|(\d+):(\d+\.?\d*)/);
    if (!match)
        return null;
    if (match[1] !== undefined) {
        // HH:MM:SS format
        return parseInt(match[1]) * 3600 + parseInt(match[2]) * 60 + parseFloat(match[3]);
    }
    else if (match[4] !== undefined) {
        // MM:SS format
        return parseInt(match[4]) * 60 + parseFloat(match[5]);
    }
    return null;
}
/**
 * Default ROI configuration for Phase 2 (4 regions)
 * Added: 2025-11-14 - MVP implementation (bottom subtitle area)
 * Updated: 2025-11-14 - Phase 2 implementation (4 regions)
 * Covers 95%+ of videos with text overlays
 */
const DEFAULT_ROI_CONFIG = {
    enabled: false, // Disabled by default for backward compatibility
    regions: [
        {
            name: 'bottom_subtitle',
            crop: 'iw:ih*0.15:0:ih*0.85', // Bottom 15% of frame
            thresholds: [0.01, 0.015], // Lower thresholds for subtitle detection
            description: 'Bottom 15% subtitle area - detects text overlay changes'
        },
        {
            name: 'center_text',
            crop: 'iw:ih*0.15:0:ih*0.425', // Center 15% of frame
            thresholds: [0.01, 0.015], // Lower thresholds for text detection
            description: 'Center 15% main text area - detects primary text changes'
        },
        {
            name: 'top_left_logo',
            crop: 'iw*0.25:ih*0.1:0:0', // Top-left 25x10% area
            thresholds: [0.015, 0.02], // Slightly higher thresholds for logo/branding
            description: 'Top-left 10% logo area - detects logo/branding changes'
        },
        {
            name: 'top_right_info',
            crop: 'iw*0.25:ih*0.1:iw*0.75:0', // Top-right 25x10% area
            thresholds: [0.015, 0.02], // Slightly higher thresholds for timestamp/info
            description: 'Top-right 10% info area - detects timestamp/metadata changes'
        }
    ],
    deduplicationInterval: 0.1 // 100ms deduplication (typical subtitle display precision)
};
/**
 * Default configuration based on V2 implementation
 * Updated: 2025-11-14 - Fine-tuned thresholds for stricter scene detection
 * Updated: 2025-11-14 - Increased minSceneInterval to skip fade-in animations
 */
const DEFAULT_CONFIG = {
    thresholds: [0.025, 0.055, 0.085], // Stricter multi-pass detection (fine-tuned from [0.02, 0.05, 0.08])
    minSceneDuration: 0.5, // Filter out very short scenes (0.5s threshold)
    minSceneInterval: 1.0, // Minimum 1.0 seconds between consecutive scene cuts (increased from 0.5s to skip subtitle fade-ins)
    roi: undefined // ROI disabled by default (opt-in feature)
};
/**
 * Load ROI configuration from environment variables
 * Allows runtime configuration without code changes
 * @returns ROI configuration or undefined if disabled
 */
function loadROIConfigFromEnv() {
    const enabled = process.env.ROI_DETECTION_ENABLED === 'true';
    if (!enabled) {
        console.log('🔍 ROI detection disabled (ROI_DETECTION_ENABLED not set to "true")');
        return undefined;
    }
    console.log('🔍 ROI detection enabled via environment variable');
    // Use default configuration for MVP (bottom subtitle area)
    // Future: Parse custom regions from ROI_REGIONS environment variable (JSON format)
    return DEFAULT_ROI_CONFIG;
}
/**
 * Validate FFmpeg crop filter syntax
 * Prevents runtime errors from invalid crop expressions
 * @param cropFilter - FFmpeg crop filter string (e.g., "iw:ih*0.15:0:ih*0.85")
 * @returns true if valid
 * @throws Error if invalid syntax
 */
function validateCropFilter(cropFilter) {
    // Basic regex validation for crop syntax: width:height:x:y
    // Allows: iw, ih, numeric values, arithmetic operators (*, +, -, /)
    const regex = /^(iw|ih|\d+)([\*\+\-\/][\d\.]+)?:(iw|ih|\d+)([\*\+\-\/][\d\.]+)?:(\d+|iw[\*\+\-\/][\d\.]+|ih[\*\+\-\/][\d\.]+)?:(iw|ih|\d+)([\*\+\-\/][\d\.]+)?$/;
    if (!regex.test(cropFilter)) {
        throw new Error(`Invalid crop filter syntax: ${cropFilter}\n` +
            `Expected format: width:height:x:y\n` +
            `Examples:\n` +
            `  - iw:ih*0.3:0:ih*0.7 (bottom 30%)\n` +
            `  - iw:ih*0.15:0:ih*0.85 (bottom 15%)\n` +
            `  - iw*0.5:ih:100:0 (left 50%, offset 100px from left)`);
    }
    return true;
}
/**
 * Merge scene cuts from full-frame and ROI detection
 * Preserves source information and assigns detection reasons
 * @param fullFrameCuts - Cuts detected from full-frame analysis
 * @param roiCuts - Cuts detected from ROI analysis
 * @param roiRegionName - Name of the ROI region (e.g., 'bottom_subtitle')
 * @returns Merged array of scene cuts with source and detectionReason fields
 */
function mergeCutsWithSource(fullFrameCuts, roiCuts, roiRegionName = 'roi_bottom') {
    const mergedMap = new Map();
    // Add full-frame cuts with source='full_frame'
    fullFrameCuts.forEach(cut => {
        mergedMap.set(cut.timestamp, {
            ...cut,
            source: 'full_frame',
            detectionReason: 'scene_change'
        });
    });
    // Add or merge ROI cuts
    roiCuts.forEach(cut => {
        const existing = mergedMap.get(cut.timestamp);
        if (existing) {
            // Detected by both full-frame and ROI → source='both'
            mergedMap.set(cut.timestamp, {
                timestamp: cut.timestamp,
                confidence: Math.max(existing.confidence, cut.confidence),
                source: 'both',
                detectionReason: 'both'
            });
        }
        else {
            // Detected only by ROI → infer source from region name
            const source = roiRegionName === 'bottom_subtitle' ? 'roi_bottom' :
                roiRegionName === 'center_text' ? 'roi_center' :
                    roiRegionName === 'top_left_logo' ? 'roi_top_left' :
                        roiRegionName === 'top_right_info' ? 'roi_top_right' : 'roi_bottom';
            const detectionReason = roiRegionName === 'bottom_subtitle' ? 'subtitle_change' : 'text_overlay_change';
            mergedMap.set(cut.timestamp, {
                ...cut,
                source: source,
                detectionReason
            });
        }
    });
    // Convert map to sorted array
    return Array.from(mergedMap.values())
        .sort((a, b) => a.timestamp - b.timestamp);
}
/**
 * Remove duplicate scene cuts that are too close together
 * Enhanced version that preserves source and detectionReason fields
 * @param cuts - Array of scene cuts to deduplicate
 * @param minInterval - Minimum interval in seconds between cuts (default: 0.1s)
 * @returns Deduplicated array of scene cuts
 */
function deduplicateCuts(cuts, minInterval = 0.1) {
    if (cuts.length === 0)
        return cuts;
    const deduplicated = [cuts[0]];
    let removedCount = 0;
    for (let i = 1; i < cuts.length; i++) {
        const lastCut = deduplicated[deduplicated.length - 1];
        const currentCut = cuts[i];
        const timeDiff = currentCut.timestamp - lastCut.timestamp;
        if (timeDiff >= minInterval) {
            // Keep this cut (sufficiently far from previous)
            deduplicated.push(currentCut);
        }
        else {
            // Too close → choose cut with higher confidence
            if (currentCut.confidence > lastCut.confidence) {
                deduplicated[deduplicated.length - 1] = currentCut;
                console.log(`  ⚠️  Replaced duplicate at ${lastCut.timestamp.toFixed(1)}s ` +
                    `with higher confidence cut at ${currentCut.timestamp.toFixed(1)}s ` +
                    `(confidence: ${lastCut.confidence} → ${currentCut.confidence})`);
            }
            removedCount++;
        }
    }
    if (removedCount > 0) {
        console.log(`  ✓ Deduplication: ${cuts.length} → ${deduplicated.length} cuts ` +
            `(removed: ${removedCount}, minInterval: ${minInterval}s)`);
    }
    return deduplicated;
}
/**
 * ROI-based multi-pass scene detection
 * Runs detection on a cropped region with multiple thresholds
 * @param videoPath - Path to the video file
 * @param region - ROI region configuration
 * @returns Array of scene cuts detected in the ROI
 */
async function detectROICuts(videoPath, region) {
    const allCuts = new Map(); // timestamp -> confidence
    console.log(`🔍 Starting ROI scene detection for region: ${region.name}`);
    console.log(`  Crop: ${region.crop}, Thresholds: ${region.thresholds.join(', ')}`);
    for (const threshold of region.thresholds) {
        console.log(`  📊 Running ROI detection pass with threshold ${threshold}...`);
        const cuts = await runSceneDetectionWithCrop(videoPath, region.crop, threshold);
        console.log(`  ✓ Found ${cuts.length} cuts in ROI at threshold ${threshold}`);
        // Merge cuts with maximum confidence
        cuts.forEach(cut => {
            const existingConfidence = allCuts.get(cut.timestamp) || 0;
            allCuts.set(cut.timestamp, Math.max(existingConfidence, cut.confidence));
        });
    }
    // Convert map to array and sort by timestamp
    const mergedCuts = Array.from(allCuts.entries())
        .map(([timestamp, confidence]) => ({ timestamp, confidence }))
        .sort((a, b) => a.timestamp - b.timestamp);
    console.log(`✅ ROI detection complete: ${mergedCuts.length} total scene cuts in ${region.name}`);
    return mergedCuts;
}
/**
 * Multi-pass FFmpeg scene detection with optional ROI support
 * Runs detection with multiple thresholds and merges results
 * Optionally includes ROI-based detection for subtitle/text changes
 * @param videoPath - Path to the video file
 * @param config - Detection configuration
 * @param videoDuration - Video duration in seconds (for progress tracking)
 * @param onProgress - Progress callback for UI updates
 * @returns Array of scene cuts with confidence scores and source information
 */
async function detectSceneCuts(videoPath, config = DEFAULT_CONFIG, videoDuration, onProgress) {
    // Load ROI configuration from environment if not provided in config
    const roiConfig = config.roi || loadROIConfigFromEnv();
    // Step 1: Full-frame multi-pass scene detection (PARALLEL)
    const allCuts = new Map(); // timestamp -> confidence
    console.log(`🔍 Starting PARALLEL multi-pass scene detection with thresholds: ${config.thresholds.join(', ')}`);
    // Track progress across parallel runs (use max progress from any threshold)
    let maxProgressTime = 0;
    let lastProgressCall = 0;
    const progressWrapper = onProgress
        ? (currentTime, totalDuration, formatted) => {
            const now = Date.now();
            // Forward progress if it's higher than before, or if it's been more than 1 second
            if (currentTime > maxProgressTime || (now - lastProgressCall) > 1000) {
                if (currentTime > maxProgressTime) {
                    maxProgressTime = currentTime;
                }
                lastProgressCall = now;
                console.log(`  [detectSceneCuts] Forwarding progress: ${formatted}`);
                onProgress(currentTime, totalDuration, formatted);
            }
        }
        : undefined;
    // Run all threshold detections in parallel
    const startTime = Date.now();
    const thresholdResults = await Promise.all(config.thresholds.map(async (threshold) => {
        console.log(`  📊 Starting detection pass with threshold ${threshold}...`);
        const cuts = await runSceneDetection(videoPath, threshold, videoDuration, progressWrapper);
        console.log(`  ✓ Found ${cuts.length} cuts at threshold ${threshold}`);
        return { threshold, cuts };
    }));
    // Merge all results
    thresholdResults.forEach(({ cuts }) => {
        cuts.forEach(cut => {
            const existingConfidence = allCuts.get(cut.timestamp) || 0;
            allCuts.set(cut.timestamp, Math.max(existingConfidence, cut.confidence));
        });
    });
    const parallelTime = Date.now() - startTime;
    console.log(`  ⚡ Parallel detection completed in ${(parallelTime / 1000).toFixed(1)}s`);
    // Convert map to array and sort by timestamp
    let fullFrameCuts = Array.from(allCuts.entries())
        .map(([timestamp, confidence]) => ({ timestamp, confidence }))
        .sort((a, b) => a.timestamp - b.timestamp);
    console.log(`✅ Full-frame detection complete: ${fullFrameCuts.length} scene cuts`);
    // Step 2: ROI-based scene detection (if enabled) - PARALLEL
    let finalCuts = fullFrameCuts;
    if (roiConfig && roiConfig.enabled && roiConfig.regions.length > 0) {
        console.log(`🎯 ROI detection enabled: processing ${roiConfig.regions.length} region(s) in PARALLEL`);
        // Phase 2: Process all ROI regions in parallel
        const roiStartTime = Date.now();
        // Log all regions being processed
        roiConfig.regions.forEach(region => {
            console.log(`  📍 Region: ${region.name} (${region.crop})`);
        });
        // Run all ROI detections in parallel
        const roiResults = await Promise.all(roiConfig.regions.map(async (region) => {
            const cuts = await detectROICuts(videoPath, region);
            return { region, cuts };
        }));
        // Aggregate results
        let allRoiCuts = [];
        const roiRegionCounts = {};
        roiResults.forEach(({ region, cuts }) => {
            roiRegionCounts[region.name] = cuts.length;
            allRoiCuts = [...allRoiCuts, ...cuts];
            console.log(`   ✅ Region "${region.name}": ${cuts.length} cuts detected`);
        });
        const roiParallelTime = Date.now() - roiStartTime;
        console.log(`  ⚡ Parallel ROI detection completed in ${(roiParallelTime / 1000).toFixed(1)}s`);
        console.log(`\n📊 ROI Detection Summary:`);
        console.log(`   Full-frame cuts: ${fullFrameCuts.length}`);
        Object.entries(roiRegionCounts).forEach(([name, count]) => {
            console.log(`   ${name}: ${count} cuts`);
        });
        console.log(`   Total ROI cuts (before merge): ${allRoiCuts.length}`);
        // Merge all ROI results with full-frame (use generic 'roi_detection' as source)
        const mergedCuts = mergeCutsWithSource(fullFrameCuts, allRoiCuts, 'roi_detection');
        console.log(`✅ Merged full-frame (${fullFrameCuts.length}) + ROI (${allRoiCuts.length}) → ${mergedCuts.length} total cuts`);
        // Deduplicate with ROI-specific interval (default: 100ms)
        const deduplicationInterval = roiConfig.deduplicationInterval || 0.1;
        finalCuts = deduplicateCuts(mergedCuts, deduplicationInterval);
    }
    else {
        console.log(`ℹ️  ROI detection disabled (using full-frame results only)`);
        finalCuts = fullFrameCuts;
    }
    console.log(`✅ Scene detection complete: ${finalCuts.length} total scene cuts`);
    // Step 3: Apply minimum scene interval filter if configured
    if (config.minSceneInterval && config.minSceneInterval > 0) {
        const filteredCuts = filterCloseScenes(finalCuts, config.minSceneInterval);
        // Log ROI detection results summary
        if (roiConfig && roiConfig.enabled) {
            logROIDetectionResults(filteredCuts);
        }
        return filteredCuts;
    }
    // Log ROI detection results summary
    if (roiConfig && roiConfig.enabled) {
        logROIDetectionResults(finalCuts);
    }
    return finalCuts;
}
/**
 * Log ROI detection results with source and detection reason
 * Provides visual summary of how each scene was detected
 * @param cuts - Array of scene cuts with source/detectionReason fields
 */
function logROIDetectionResults(cuts) {
    if (cuts.length === 0) {
        console.log('ℹ️  No scene cuts to analyze');
        return;
    }
    // Count detection sources
    const stats = {
        fullFrame: 0,
        roiOnly: 0,
        both: 0,
        noSource: 0
    };
    cuts.forEach(cut => {
        if (!cut.source) {
            stats.noSource++;
        }
        else if (cut.source === 'full_frame') {
            stats.fullFrame++;
        }
        else if (cut.source === 'both') {
            stats.both++;
        }
        else {
            stats.roiOnly++;
        }
    });
    console.log('\n📊 ROI Detection Results Summary:');
    console.log(`   Total scene cuts: ${cuts.length}`);
    if (stats.noSource > 0) {
        console.log(`   🎬 Full-frame only: ${stats.noSource} (backward compatible mode)`);
    }
    else {
        console.log(`   🎬 Full-frame detection: ${stats.fullFrame} (camera work, scene changes)`);
        console.log(`   🎯 ROI detection: ${stats.roiOnly} (subtitle/text changes)`);
        console.log(`   🔗 Both detected: ${stats.both} (scene change + text change)`);
    }
    // Detailed breakdown (first 10 cuts)
    if (cuts.length > 0 && cuts[0].source) {
        console.log('\n   First 10 scene cuts:');
        cuts.slice(0, 10).forEach((cut, idx) => {
            const icon = cut.source === 'full_frame' ? '🎬' :
                cut.source === 'both' ? '🔗' : '🎯';
            const reason = cut.detectionReason || 'unknown';
            console.log(`   ${icon} ${(idx + 1).toString().padStart(2)}) ${cut.timestamp.toFixed(1)}s (${reason})`);
        });
        if (cuts.length > 10) {
            console.log(`   ... and ${cuts.length - 10} more cuts`);
        }
    }
    console.log('');
}
/**
 * Filter out scene cuts that are too close together
 * Prevents detection of multiple similar scenes in rapid succession
 * @param cuts - Array of scene cuts
 * @param minInterval - Minimum interval in seconds between scene cuts
 * @returns Filtered array of scene cuts
 */
function filterCloseScenes(cuts, minInterval) {
    if (cuts.length === 0)
        return cuts;
    const filteredCuts = [cuts[0]];
    let skippedCount = 0;
    for (let i = 1; i < cuts.length; i++) {
        const timeSinceLastCut = cuts[i].timestamp - filteredCuts[filteredCuts.length - 1].timestamp;
        if (timeSinceLastCut >= minInterval) {
            filteredCuts.push(cuts[i]);
        }
        else {
            skippedCount++;
            console.log(`  ⏭️  Skipping close scene cut at ${cuts[i].timestamp.toFixed(1)}s (${timeSinceLastCut.toFixed(1)}s < ${minInterval}s since last cut)`);
        }
    }
    console.log(`  ✓ Filtered ${cuts.length} → ${filteredCuts.length} cuts (minInterval: ${minInterval}s, skipped: ${skippedCount})`);
    return filteredCuts;
}
/**
 * Run FFmpeg scene detection with single threshold
 * Uses spawn directly with gVisor-compatible environment settings
 * @param videoPath - Path to the video file
 * @param threshold - Scene detection threshold (0.0-1.0)
 * @returns Array of scene cuts
 */
function runSceneDetection(videoPath, threshold, videoDuration, onProgress) {
    return new Promise((resolve, reject) => {
        const cuts = [];
        const TIMEOUT_MS = getSceneDetectionTimeout();
        let completed = false;
        let lastProgressTime = 0;
        const PROGRESS_INTERVAL_MS = 500; // Update progress every 0.5 seconds for more responsive UI
        let lastProgressUpdate = 0;
        console.log(`    [SceneDetect] Starting FFmpeg spawn for threshold ${threshold} (timeout: ${TIMEOUT_MS / 60000}min)...`);
        // Set gVisor-compatible environment
        const ffmpegEnv = {
            ...process.env,
            FONTCONFIG_PATH: '',
            FONTCONFIG_FILE: '/dev/null',
            FC_DEBUG: '0',
            HOME: '/tmp',
            XDG_CACHE_HOME: '/tmp',
            XDG_CONFIG_HOME: '/tmp',
            FFREPORT: '',
            AV_LOG_FORCE_NOCOLOR: '1',
        };
        // Use spawn directly for better control
        const ffmpegArgs = [
            '-nostdin', // Disable stdin interaction
            '-y', // Overwrite output
            '-stats', // Enable progress stats output (time=XX:XX:XX)
            '-i', videoPath,
            '-vf', `select='gt(scene,${threshold})',showinfo`,
            '-f', 'null',
            '-'
        ];
        console.log(`    [SceneDetect] FFmpeg command: ffmpeg ${ffmpegArgs.join(' ').substring(0, 100)}...`);
        const proc = spawn('ffmpeg', ffmpegArgs, {
            env: ffmpegEnv,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stderrBuffer = '';
        let lastActivityTime = Date.now();
        // Timeout handler
        const timeoutId = setTimeout(() => {
            if (!completed) {
                completed = true;
                console.error(`    [SceneDetect] ❌ Timeout after ${TIMEOUT_MS / 1000}s (threshold: ${threshold})`);
                proc.kill('SIGKILL');
                reject(new Error(`FFmpeg scene detection timed out after ${TIMEOUT_MS}ms (threshold: ${threshold})`));
            }
        }, TIMEOUT_MS);
        // Timer-based progress estimation (fallback when FFmpeg stats don't show time=)
        // Estimate: FFmpeg processes video at ~10-50x realtime speed on Cloud Run
        const estimatedSpeedMultiplier = 20; // Conservative estimate
        const startTime = Date.now();
        let timerProgressInterval = null;
        let lastTimerUpdate = 0;
        const updateTimerProgress = () => {
            if (completed)
                return;
            const elapsedMs = Date.now() - startTime;
            const estimatedCurrentTime = Math.min((elapsedMs / 1000) * estimatedSpeedMultiplier, videoDuration * 0.95 // Cap at 95% to avoid showing 100% before completion
            );
            // Update every time (don't check lastProgressTime - let progressWrapper handle dedup)
            const formatted = `${formatTimeForProgress(estimatedCurrentTime)} / ${formatTimeForProgress(videoDuration)}`;
            console.log(`    [SceneDetect] Timer-based progress: ${formatted} (elapsed: ${elapsedMs}ms)`);
            onProgress(estimatedCurrentTime, videoDuration, formatted);
            lastTimerUpdate = Date.now();
        };
        if (onProgress && videoDuration && videoDuration > 0) {
            // Fire immediately, then every 1 second
            updateTimerProgress();
            timerProgressInterval = setInterval(updateTimerProgress, 1000);
        }
        // Activity watchdog - kill if no output for 60 seconds
        const activityInterval = setInterval(() => {
            const idleTime = Date.now() - lastActivityTime;
            if (idleTime > 60000) { // 60 seconds idle
                if (!completed) {
                    completed = true;
                    console.error(`    [SceneDetect] ❌ FFmpeg idle for ${idleTime / 1000}s - killing process`);
                    clearTimeout(timeoutId);
                    clearInterval(activityInterval);
                    if (timerProgressInterval)
                        clearInterval(timerProgressInterval);
                    proc.kill('SIGKILL');
                    reject(new Error(`FFmpeg scene detection stalled (no output for ${idleTime / 1000}s)`));
                }
            }
        }, 10000); // Check every 10 seconds
        // Handle stdout (not used but capture anyway)
        proc.stdout?.on('data', () => {
            lastActivityTime = Date.now();
        });
        // Handle stderr (contains scene detection output)
        proc.stderr?.on('data', (data) => {
            lastActivityTime = Date.now();
            stderrBuffer += data.toString();
            // Process complete lines
            // Note: FFmpeg uses \r for progress updates and \n for other messages
            const lines = stderrBuffer.split(/[\r\n]+/);
            stderrBuffer = lines.pop() || ''; // Keep incomplete line in buffer
            for (const line of lines) {
                // Debug: Log FFmpeg progress lines (sample every 10th to avoid spam)
                if (line.includes('frame=') && Math.random() < 0.1) {
                    console.log(`    [SceneDetect] FFmpeg line sample: ${line.substring(0, 100)}`);
                }
                // Parse FFmpeg output for scene timestamps
                // Format: "frame:123 pts:12345 pts_time:12.345"
                const ptsMatch = line.match(/pts_time:(\d+\.?\d*)/);
                if (ptsMatch) {
                    const timestamp = parseFloat(ptsMatch[1]);
                    cuts.push({
                        timestamp: Math.floor(timestamp * 10) / 10, // Round to 0.1s precision
                        confidence: threshold
                    });
                }
                // Parse FFmpeg progress output for current position
                // Format: "frame=  123 fps= 50 q=-0.0 size=N/A time=00:01:23.45 bitrate=N/A"
                if (onProgress && videoDuration && videoDuration > 0) {
                    const timeMatch = line.match(/time=(\d+:\d+:\d+\.?\d*|\d+:\d+\.?\d*)/);
                    if (timeMatch) {
                        const currentTime = parseFFmpegTime(timeMatch[1]);
                        console.log(`    [SceneDetect] Progress: time=${timeMatch[1]} → ${currentTime}s (duration: ${videoDuration}s)`);
                        if (currentTime !== null && currentTime > lastProgressTime) {
                            const now = Date.now();
                            // Throttle progress updates to avoid flooding
                            if (now - lastProgressUpdate >= PROGRESS_INTERVAL_MS) {
                                lastProgressTime = currentTime;
                                lastProgressUpdate = now;
                                const formatted = `${formatTimeForProgress(currentTime)} / ${formatTimeForProgress(videoDuration)}`;
                                console.log(`    [SceneDetect] Calling progress callback: ${formatted}`);
                                onProgress(currentTime, videoDuration, formatted);
                            }
                        }
                    }
                }
            }
        });
        proc.on('close', (code, signal) => {
            if (completed)
                return;
            completed = true;
            clearTimeout(timeoutId);
            clearInterval(activityInterval);
            if (timerProgressInterval)
                clearInterval(timerProgressInterval);
            if (code === 0 || code === null) {
                // Process any remaining data in buffer
                if (stderrBuffer) {
                    const match = stderrBuffer.match(/pts_time:(\d+\.?\d*)/);
                    if (match) {
                        const timestamp = parseFloat(match[1]);
                        cuts.push({
                            timestamp: Math.floor(timestamp * 10) / 10,
                            confidence: threshold
                        });
                    }
                }
                console.log(`    [SceneDetect] ✓ FFmpeg completed: ${cuts.length} cuts detected`);
                resolve(cuts);
            }
            else {
                console.error(`    [SceneDetect] FFmpeg exited with code ${code}, signal ${signal}`);
                reject(new Error(`FFmpeg scene detection failed with code ${code}`));
            }
        });
        proc.on('error', (err) => {
            if (completed)
                return;
            completed = true;
            clearTimeout(timeoutId);
            clearInterval(activityInterval);
            if (timerProgressInterval)
                clearInterval(timerProgressInterval);
            console.error(`    [SceneDetect] FFmpeg spawn error: ${err.message}`);
            reject(new Error(`FFmpeg spawn error: ${err.message}`));
        });
    });
}
/**
 * Run FFmpeg scene detection on a cropped region (ROI-based detection)
 * Uses spawn directly with gVisor-compatible environment settings
 * @param videoPath - Path to the video file
 * @param cropFilter - FFmpeg crop filter syntax (e.g., "iw:ih*0.15:0:ih*0.85")
 * @param threshold - Scene detection threshold (0.0-1.0)
 * @returns Array of scene cuts detected in the ROI
 */
function runSceneDetectionWithCrop(videoPath, cropFilter, threshold) {
    return new Promise((resolve, reject) => {
        // Validate crop filter syntax before execution
        try {
            validateCropFilter(cropFilter);
        }
        catch (error) {
            reject(error);
            return;
        }
        const cuts = [];
        const TIMEOUT_MS = getSceneDetectionTimeout();
        let completed = false;
        console.log(`    [SceneDetect-ROI] Starting FFmpeg spawn (crop: ${cropFilter}, threshold: ${threshold}, timeout: ${TIMEOUT_MS / 60000}min)...`);
        // Set gVisor-compatible environment
        const ffmpegEnv = {
            ...process.env,
            FONTCONFIG_PATH: '',
            FONTCONFIG_FILE: '/dev/null',
            FC_DEBUG: '0',
            HOME: '/tmp',
            XDG_CACHE_HOME: '/tmp',
            XDG_CONFIG_HOME: '/tmp',
            FFREPORT: '',
            AV_LOG_FORCE_NOCOLOR: '1',
        };
        // Use spawn directly for better control
        const ffmpegArgs = [
            '-nostdin', // Disable stdin interaction
            '-y', // Overwrite output
            '-i', videoPath,
            '-vf', `crop=${cropFilter},select='gt(scene,${threshold})',showinfo`,
            '-f', 'null',
            '-'
        ];
        const proc = spawn('ffmpeg', ffmpegArgs, {
            env: ffmpegEnv,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stderrBuffer = '';
        let lastActivityTime = Date.now();
        // Timeout handler
        const timeoutId = setTimeout(() => {
            if (!completed) {
                completed = true;
                console.error(`    [SceneDetect-ROI] ❌ Timeout after ${TIMEOUT_MS / 1000}s`);
                proc.kill('SIGKILL');
                reject(new Error(`FFmpeg ROI scene detection timed out after ${TIMEOUT_MS}ms ` +
                    `(crop: ${cropFilter}, threshold: ${threshold})`));
            }
        }, TIMEOUT_MS);
        // Activity watchdog - kill if no output for 60 seconds
        const activityInterval = setInterval(() => {
            const idleTime = Date.now() - lastActivityTime;
            if (idleTime > 60000) { // 60 seconds idle
                if (!completed) {
                    completed = true;
                    console.error(`    [SceneDetect-ROI] ❌ FFmpeg idle for ${idleTime / 1000}s - killing process`);
                    clearTimeout(timeoutId);
                    clearInterval(activityInterval);
                    proc.kill('SIGKILL');
                    reject(new Error(`FFmpeg ROI scene detection stalled (no output for ${idleTime / 1000}s)`));
                }
            }
        }, 10000); // Check every 10 seconds
        proc.stdout?.on('data', () => {
            lastActivityTime = Date.now();
        });
        proc.stderr?.on('data', (data) => {
            lastActivityTime = Date.now();
            stderrBuffer += data.toString();
            // Process complete lines
            // Note: FFmpeg uses \r for progress updates and \n for other messages
            const lines = stderrBuffer.split(/[\r\n]+/);
            stderrBuffer = lines.pop() || '';
            for (const line of lines) {
                const match = line.match(/pts_time:(\d+\.?\d*)/);
                if (match) {
                    const timestamp = parseFloat(match[1]);
                    cuts.push({
                        timestamp: Math.floor(timestamp * 10) / 10,
                        confidence: threshold
                    });
                }
            }
        });
        proc.on('close', (code, signal) => {
            if (completed)
                return;
            completed = true;
            clearTimeout(timeoutId);
            clearInterval(activityInterval);
            if (code === 0 || code === null) {
                if (stderrBuffer) {
                    const match = stderrBuffer.match(/pts_time:(\d+\.?\d*)/);
                    if (match) {
                        const timestamp = parseFloat(match[1]);
                        cuts.push({
                            timestamp: Math.floor(timestamp * 10) / 10,
                            confidence: threshold
                        });
                    }
                }
                console.log(`    [SceneDetect-ROI] ✓ FFmpeg completed: ${cuts.length} cuts detected`);
                resolve(cuts);
            }
            else {
                console.error(`    [SceneDetect-ROI] FFmpeg exited with code ${code}, signal ${signal}`);
                reject(new Error(`FFmpeg ROI scene detection failed with code ${code}`));
            }
        });
        proc.on('error', (err) => {
            if (completed)
                return;
            completed = true;
            clearTimeout(timeoutId);
            clearInterval(activityInterval);
            console.error(`    [SceneDetect-ROI] FFmpeg spawn error: ${err.message}`);
            reject(new Error(`FFmpeg ROI spawn error: ${err.message}`));
        });
    });
}
/**
 * Generate scene ranges from detected cuts
 * Calculates mid-point (50% between scene detection points)
 * @param cuts - Array of scene cuts
 * @param videoDuration - Total video duration in seconds
 * @param config - Scene detection configuration
 * @returns Array of scene ranges with mid-points
 */
async function generateSceneRanges(cuts, videoDuration, config = DEFAULT_CONFIG) {
    const scenes = [];
    let sceneNumber = 1;
    console.log(`📐 Generating scene ranges from ${cuts.length} cuts...`);
    for (let i = 0; i < cuts.length; i++) {
        const startTime = cuts[i].timestamp;
        const endTime = i < cuts.length - 1 ? cuts[i + 1].timestamp : videoDuration;
        const duration = endTime - startTime;
        // Filter out very short scenes
        // Note: sceneNumber increments ONLY for valid scenes (duration >= minSceneDuration)
        // This ensures sequential numbering (1, 2, 3...) even when short scenes are skipped
        if (duration < config.minSceneDuration) {
            console.log(`  ⏭️  Skipping short scene (${duration.toFixed(2)}s < ${config.minSceneDuration}s)`);
            continue; // Skip without consuming a scene number
        }
        // Calculate screenshot capture point (50% mid-point position)
        // Combined with minSceneInterval=1.0s to ensure fade-in animations are complete
        // The 1.0s interval skips fade-in detections, so mid-point (50%) is now optimal
        const captureRatio = 0.5; // 50% mid-point (reverted from 0.75)
        const midTime = startTime + (endTime - startTime) * captureRatio;
        scenes.push({
            sceneNumber,
            startTime, // Detection point A (前)
            endTime, // Detection point B (後)
            midTime, // 75% position for screenshot (captures after text animations)
            timecode: formatTimecode(startTime) // Timecode assigned to scene start
        });
        sceneNumber++;
    }
    console.log(`✅ Generated ${scenes.length} valid scene ranges`);
    return scenes;
}
/**
 * Extract frame at specific timestamp with adaptive quality optimization
 * Uses spawn directly with gVisor-compatible environment settings
 * @param videoPath - Path to the video file
 * @param timestamp - Time in seconds
 * @param outputPath - Output file path for frame
 * @param videoMetadata - Optional video metadata for adaptive resizing
 */
export async function extractFrameAtTime(videoPath, timestamp, outputPath, videoMetadata, targetWidth) {
    return new Promise((resolve, reject) => {
        const TIMEOUT_MS = 60000; // 60 seconds for frame extraction
        let completed = false;
        // Build filter chain
        const filters = [];
        if (targetWidth) {
            // Reduced resolution for Excel embedding (e.g., 320px wide)
            filters.push(`scale=${targetWidth}:-1`);
        }
        else {
            // Adaptive resolution: maintain original if <= 1920x1080, otherwise resize
            const shouldResize = videoMetadata &&
                (videoMetadata.width > 1920 || videoMetadata.height > 1080);
            if (shouldResize) {
                filters.push('scale=1920:1080:force_original_aspect_ratio=decrease');
            }
            // Sharpness filter for OCR clarity (not needed for Excel display)
            filters.push('unsharp=5:5:1.0:5:5:0.0');
        }
        // Set gVisor-compatible environment
        const ffmpegEnv = {
            ...process.env,
            FONTCONFIG_PATH: '',
            FONTCONFIG_FILE: '/dev/null',
            FC_DEBUG: '0',
            HOME: '/tmp',
            XDG_CACHE_HOME: '/tmp',
            XDG_CONFIG_HOME: '/tmp',
            FFREPORT: '',
            AV_LOG_FORCE_NOCOLOR: '1',
        };
        const ffmpegArgs = [
            '-nostdin',
            '-y',
            '-ss', timestamp.toString(),
            '-i', videoPath,
            '-frames:v', '1',
            '-vf', filters.join(','),
            '-pix_fmt', 'rgb24',
            outputPath
        ];
        const proc = spawn('ffmpeg', ffmpegArgs, {
            env: ffmpegEnv,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let lastActivityTime = Date.now();
        // Timeout handler
        const timeoutId = setTimeout(() => {
            if (!completed) {
                completed = true;
                proc.kill('SIGKILL');
                reject(new Error(`Frame extraction timed out after ${TIMEOUT_MS}ms at ${timestamp}s`));
            }
        }, TIMEOUT_MS);
        // Activity watchdog
        const activityInterval = setInterval(() => {
            const idleTime = Date.now() - lastActivityTime;
            if (idleTime > 30000) { // 30 seconds idle for frame extraction
                if (!completed) {
                    completed = true;
                    clearTimeout(timeoutId);
                    clearInterval(activityInterval);
                    proc.kill('SIGKILL');
                    reject(new Error(`Frame extraction stalled (no output for ${idleTime / 1000}s)`));
                }
            }
        }, 5000);
        proc.stdout?.on('data', () => {
            lastActivityTime = Date.now();
        });
        proc.stderr?.on('data', () => {
            lastActivityTime = Date.now();
        });
        proc.on('close', (code) => {
            if (completed)
                return;
            completed = true;
            clearTimeout(timeoutId);
            clearInterval(activityInterval);
            if (code === 0) {
                resolve();
            }
            else {
                reject(new Error(`Frame extraction failed with code ${code} at ${timestamp}s`));
            }
        });
        proc.on('error', (err) => {
            if (completed)
                return;
            completed = true;
            clearTimeout(timeoutId);
            clearInterval(activityInterval);
            reject(new Error(`Frame extraction spawn error: ${err.message}`));
        });
    });
}
/**
 * Quick check if ffprobe is working
 */
async function checkFfprobeAvailable() {
    return new Promise((resolve) => {
        const proc = spawn('ffprobe', ['-version'], {
            stdio: ['ignore', 'pipe', 'pipe'],
            timeout: 5000,
        });
        let output = '';
        proc.stdout?.on('data', (data) => {
            output += data.toString();
        });
        proc.on('close', (code) => {
            if (code === 0 && output.includes('ffprobe')) {
                console.log(`[Metadata] ffprobe available: ${output.split('\n')[0]}`);
                resolve(true);
            }
            else {
                console.error(`[Metadata] ffprobe not available or failed`);
                resolve(false);
            }
        });
        proc.on('error', () => {
            console.error(`[Metadata] ffprobe spawn error`);
            resolve(false);
        });
        // Timeout fallback
        setTimeout(() => {
            proc.kill();
            resolve(false);
        }, 5000);
    });
}
/**
 * Quick diagnostic: verify ffprobe binary works
 * Uses execSync with shell timeout for reliable timeout control
 * Returns version string if working, throws if not
 */
function verifyFfprobeWorks() {
    try {
        // Use shell timeout command for reliable timeout
        // This works because we added 'timeout' via coreutils in the Dockerfile
        const result = execSync('timeout 5s ffprobe -version 2>&1', {
            encoding: 'utf8',
            timeout: 10000, // Node.js level backup timeout
            maxBuffer: 1024 * 1024,
        });
        if (result.includes('ffprobe version')) {
            return result.split('\n')[0];
        }
        else {
            throw new Error(`Unexpected ffprobe output: ${result.substring(0, 100)}`);
        }
    }
    catch (err) {
        // Check if it's a timeout (exit code 124 from timeout command)
        if (err.status === 124) {
            throw new Error('ffprobe -version timed out after 5s (shell timeout)');
        }
        // Check if Node.js timeout triggered
        if (err.killed) {
            throw new Error('ffprobe -version timed out after 10s (node timeout)');
        }
        throw new Error(`ffprobe verification failed: ${err.message}`);
    }
}
/**
 * Get video metadata (duration, width, height, aspect ratio)
 * Uses fluent-ffmpeg's ffprobe with gVisor-compatible environment settings
 */
export async function getVideoMetadata(videoPath) {
    const TIMEOUT_MS = TIMEOUTS.METADATA_EXTRACTION; // 60 seconds
    console.log(`[Metadata] Starting metadata extraction for: ${videoPath}`);
    // Check if file exists and log basic info
    try {
        const stats = await fs.stat(videoPath);
        console.log(`[Metadata] File size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
    }
    catch (err) {
        console.error(`[Metadata] File not accessible: ${videoPath}`);
        throw new Error(`Video file not accessible: ${videoPath}`);
    }
    return new Promise((resolve, reject) => {
        let completed = false;
        // Set timeout
        const timeoutId = setTimeout(() => {
            if (!completed) {
                completed = true;
                console.error(`[Metadata] ffprobe timed out after ${TIMEOUT_MS / 1000}s`);
                reject(new Error(`ffprobe metadata extraction timed out after ${TIMEOUT_MS / 1000}s`));
            }
        }, TIMEOUT_MS);
        console.log(`[Metadata] Using fluent-ffmpeg ffprobe...`);
        // Use fluent-ffmpeg's ffprobe with custom options
        // Set environment variables to avoid gVisor issues
        const originalEnv = process.env;
        process.env = {
            ...originalEnv,
            FONTCONFIG_PATH: '', // Disable fontconfig (common hang cause)
            FONTCONFIG_FILE: '/dev/null',
            FC_DEBUG: '0',
            HOME: '/tmp', // Avoid writing to non-existent home
            XDG_CACHE_HOME: '/tmp',
            FFREPORT: '', // Disable ffmpeg reporting
        };
        ffmpeg.ffprobe(videoPath, [
            '-probesize', '5000000', // Limit probe size
            '-analyzeduration', '5000000', // Limit analysis duration
        ], (err, metadata) => {
            // Restore original environment
            process.env = originalEnv;
            if (completed)
                return;
            completed = true;
            clearTimeout(timeoutId);
            if (err) {
                console.error(`[Metadata] ffprobe error: ${err.message}`);
                reject(new Error(`ffprobe failed: ${err.message}`));
                return;
            }
            try {
                const duration = Math.floor(metadata.format?.duration || 0);
                const videoStream = metadata.streams?.find((s) => s.codec_type === 'video');
                if (!videoStream || !videoStream.width || !videoStream.height) {
                    reject(new Error('Could not extract video dimensions from metadata'));
                    return;
                }
                const width = videoStream.width;
                const height = videoStream.height;
                const aspectRatio = width / height;
                console.log(`📹 Video Metadata: ${width}x${height} (${aspectRatio.toFixed(2)}:1), ${duration}s`);
                resolve({
                    width,
                    height,
                    aspectRatio,
                    duration
                });
            }
            catch (parseError) {
                console.error(`[Metadata] Parse error: ${parseError}`);
                reject(new Error(`Failed to parse ffprobe output: ${parseError}`));
            }
        });
    });
}
/**
 * Get video duration in seconds (helper function)
 */
function getVideoDuration(videoPath) {
    return getVideoMetadata(videoPath).then(metadata => metadata.duration);
}
/**
 * Main scene detection and frame extraction function
 * Implements FFmpeg scene detection + mid-point frame extraction
 * @param videoPath - Path to the video file
 * @param outputDir - Directory for extracted frames (optional, defaults to /tmp/frames-{timestamp})
 * @param existingMetadata - Pre-fetched video metadata (optional, avoids duplicate ffprobe call)
 * @returns Array of Scene objects with screenshot paths
 */
export async function extractScenesWithFrames(videoPath, outputDir, existingMetadata) {
    const framesDir = outputDir || path.join('/tmp', `frames-${Date.now()}`);
    try {
        // Create output directory
        await fs.mkdir(framesDir, { recursive: true });
        console.log(`📁 Created output directory: ${framesDir}`);
        // Use existing metadata if provided, otherwise fetch (avoids ffprobe hanging on duplicate calls)
        const videoMetadata = existingMetadata || await getVideoMetadata(videoPath);
        console.log(`🎬 Video duration: ${videoMetadata.duration}s (metadata ${existingMetadata ? 'reused' : 'fetched'})`);
        // Step 1: Multi-pass scene detection
        const cuts = await detectSceneCuts(videoPath);
        if (cuts.length === 0) {
            console.warn('⚠️ No scene cuts detected, falling back to single scene');
            // Fallback: treat entire video as one scene
            cuts.push({ timestamp: 0, confidence: 0.03 });
        }
        // Step 2: Generate scene ranges with mid-points
        const scenes = await generateSceneRanges(cuts, videoMetadata.duration);
        console.log(`📸 Extracting ${scenes.length} frames at mid-points (50% position) in PARALLEL...`);
        // Step 3: Extract frames at mid-points (50% position) with adaptive quality - PARALLEL
        // Note: minSceneInterval=1.0s ensures we skip fade-in detections
        // Use pLimit to control concurrency (avoid overwhelming the system)
        const limit = pLimit(FRAME_EXTRACTION_CONCURRENCY);
        const frameStartTime = Date.now();
        await Promise.all(scenes.map((scene) => limit(async () => {
            const filename = path.join(framesDir, `scene-${scene.sceneNumber.toString().padStart(4, '0')}.png`);
            // Pass video metadata for adaptive resizing and quality optimization
            await extractFrameAtTime(videoPath, scene.midTime, filename, videoMetadata);
            // Set screenshot path
            scene.screenshotPath = filename;
            console.log(`  ✓ Scene ${scene.sceneNumber}: ${scene.timecode} (mid-point: ${scene.midTime.toFixed(1)}s)`);
        })));
        const frameParallelTime = Date.now() - frameStartTime;
        console.log(`⚡ Parallel frame extraction completed in ${(frameParallelTime / 1000).toFixed(1)}s`);
        console.log(`✅ Extracted ${scenes.length} frames at mid-points`);
        return scenes;
    }
    catch (error) {
        // Clean up on error
        try {
            await fs.rm(framesDir, { recursive: true, force: true });
        }
        catch (cleanupError) {
            console.error('⚠️ Cleanup error:', cleanupError);
        }
        throw error;
    }
}
/**
 * Clean up temporary frame files
 * @param scenes - Array of scenes with screenshot paths
 */
export async function cleanupFrames(scenes) {
    if (scenes.length === 0 || !scenes[0].screenshotPath)
        return;
    const outputDir = path.dirname(scenes[0].screenshotPath);
    try {
        await fs.rm(outputDir, { recursive: true, force: true });
        console.log(`🧹 Cleaned up temporary frames: ${outputDir}`);
    }
    catch (error) {
        console.error('⚠️ Error cleaning up frames:', error);
    }
}
// ============================================================
// Batch Processing Functions (Memory Optimization)
// Added: 2026-02-06
// Purpose: Process frames in batches to reduce peak memory usage
// ============================================================
/**
 * Default batch size for frame extraction
 * Balances memory usage (~500MB per batch) with processing efficiency
 */
export const DEFAULT_BATCH_SIZE = 100;
/**
 * Reduced concurrency for batch processing to stay within memory limits
 * With batch size 100 and concurrency 4: ~400MB peak for frame extraction
 */
const BATCH_FRAME_EXTRACTION_CONCURRENCY = 4;
/**
 * Detect scenes without extracting frames
 * Used for batch processing where frames are extracted in batches
 * @param videoPath - Path to the video file
 * @param existingMetadata - Pre-fetched video metadata (optional)
 * @returns Object containing scenes (without screenshots) and video metadata
 */
export async function detectScenesOnly(videoPath, existingMetadata, onProgress) {
    console.log('🎬 Starting scene detection (batch mode - no frame extraction)...');
    // Use existing metadata if provided, otherwise fetch
    const videoMetadata = existingMetadata || await getVideoMetadata(videoPath);
    console.log(`  📹 Video duration: ${videoMetadata.duration}s`);
    // Multi-pass scene detection with progress tracking
    const cuts = await detectSceneCuts(videoPath, DEFAULT_CONFIG, videoMetadata.duration, onProgress);
    if (cuts.length === 0) {
        console.warn('⚠️ No scene cuts detected, falling back to single scene');
        cuts.push({ timestamp: 0, confidence: 0.03 });
    }
    // Generate scene ranges with mid-points (no frame extraction)
    const scenes = await generateSceneRanges(cuts, videoMetadata.duration);
    console.log(`✅ Detected ${scenes.length} scenes (frames will be extracted in batches)`);
    return { scenes, videoMetadata };
}
/**
 * Extract frames for a batch of scenes
 * @param videoPath - Path to the video file
 * @param scenes - Batch of scenes to extract frames for
 * @param framesDir - Directory to store extracted frames
 * @param videoMetadata - Video metadata for adaptive resizing
 * @returns Updated scenes with screenshotPath set
 */
export async function extractFramesForBatch(videoPath, scenes, framesDir, videoMetadata) {
    // Ensure directory exists
    await fs.mkdir(framesDir, { recursive: true });
    const limit = pLimit(BATCH_FRAME_EXTRACTION_CONCURRENCY);
    const startTime = Date.now();
    console.log(`  📸 Extracting ${scenes.length} frames (batch, concurrency: ${BATCH_FRAME_EXTRACTION_CONCURRENCY})...`);
    await Promise.all(scenes.map((scene) => limit(async () => {
        const filename = path.join(framesDir, `scene-${scene.sceneNumber.toString().padStart(4, '0')}.png`);
        await extractFrameAtTime(videoPath, scene.midTime, filename, videoMetadata);
        // Set screenshot path
        scene.screenshotPath = filename;
    })));
    const elapsed = Date.now() - startTime;
    console.log(`  ⚡ Batch frame extraction: ${scenes.length} frames in ${(elapsed / 1000).toFixed(1)}s`);
    return scenes;
}
/**
 * Cleanup frames for a specific batch of scenes
 * Removes only the frame files for the given scenes, not the entire directory
 * @param scenes - Batch of scenes with screenshotPath to cleanup
 */
export async function cleanupBatchFrames(scenes) {
    let cleaned = 0;
    let failed = 0;
    await Promise.all(scenes.map(async (scene) => {
        if (scene.screenshotPath) {
            try {
                await fs.unlink(scene.screenshotPath);
                cleaned++;
            }
            catch (error) {
                // File might already be deleted or not exist
                failed++;
            }
            // Clear the path to free string memory
            scene.screenshotPath = undefined;
        }
    }));
    console.log(`  🧹 Batch cleanup: ${cleaned} frames deleted${failed > 0 ? `, ${failed} already gone` : ''}`);
}
/**
 * Get current memory usage for monitoring
 * @returns Memory usage info in MB
 */
export function getMemoryUsage() {
    const usage = process.memoryUsage();
    return {
        heapUsed: Math.round(usage.heapUsed / 1024 / 1024),
        heapTotal: Math.round(usage.heapTotal / 1024 / 1024),
        rss: Math.round(usage.rss / 1024 / 1024),
        external: Math.round(usage.external / 1024 / 1024),
    };
}
/**
 * Log memory usage with label
 * @param label - Description of current operation
 */
export function logMemoryUsage(label) {
    const mem = getMemoryUsage();
    console.log(`  💾 Memory [${label}]: Heap ${mem.heapUsed}/${mem.heapTotal}MB, RSS ${mem.rss}MB`);
}
/**
 * Transcode video to 720p for processing efficiency
 * Used by TransNet V2 to reduce GPU/CPU load while maintaining detection accuracy
 *
 * @param inputPath - Path to original video file
 * @param outputPath - Path for transcoded output
 * @param targetHeight - Target height in pixels (default: 720)
 * @returns Path to transcoded video
 */
export async function transcodeToProcessingResolution(inputPath, outputPath, targetHeight = 720) {
    console.log(`🎬 Transcoding to ${targetHeight}p for processing...`);
    return new Promise((resolve, reject) => {
        ffmpeg(inputPath)
            .outputOptions([
            `-vf scale=-2:${targetHeight}`, // Maintain aspect ratio, height=720
            '-c:v libx264',
            '-preset fast',
            '-crf 23',
            '-c:a copy', // Keep original audio
            '-y' // Overwrite if exists
        ])
            .output(outputPath)
            .on('start', (cmd) => {
            console.log(`  FFmpeg command: ${cmd.substring(0, 100)}...`);
        })
            .on('progress', (progress) => {
            if (progress.percent) {
                process.stdout.write(`\r  Progress: ${Math.round(progress.percent)}%`);
            }
        })
            .on('end', () => {
            console.log(`\n✅ Transcoded to ${targetHeight}p: ${outputPath}`);
            resolve(outputPath);
        })
            .on('error', (err) => {
            console.error(`❌ Transcode error: ${err.message}`);
            reject(new Error(`Transcode failed: ${err.message}`));
        })
            .run();
    });
}
/**
 * Split video into chunks with overlap for parallel processing
 * Each chunk has 10-second overlap with adjacent chunks to ensure
 * scene cuts at boundaries are detected
 *
 * @param inputPath - Path to video file
 * @param outputDir - Directory for chunk outputs
 * @param chunkDuration - Duration of each chunk in seconds (default: 60)
 * @param overlapDuration - Overlap duration in seconds (default: 10)
 * @returns Array of VideoChunk info with paths and offsets
 */
export async function splitVideoWithOverlap(inputPath, outputDir, chunkDuration = 60, overlapDuration = 10) {
    console.log(`✂️ Splitting video into ${chunkDuration}s chunks with ${overlapDuration}s overlap...`);
    // Get video duration
    const metadata = await getVideoMetadata(inputPath);
    const totalDuration = metadata.duration;
    console.log(`  Total duration: ${totalDuration.toFixed(1)}s`);
    // Create output directory
    await fs.mkdir(outputDir, { recursive: true });
    // Calculate chunk boundaries
    const chunks = [];
    let chunkIndex = 0;
    let currentStart = 0;
    while (currentStart < totalDuration) {
        // Calculate chunk boundaries with overlap
        const chunkStart = Math.max(0, currentStart - (chunkIndex > 0 ? overlapDuration : 0));
        const chunkEnd = Math.min(totalDuration, currentStart + chunkDuration + overlapDuration);
        const actualDuration = chunkEnd - chunkStart;
        const chunkPath = path.join(outputDir, `chunk_${chunkIndex.toString().padStart(3, '0')}.mp4`);
        chunks.push({
            index: chunkIndex,
            path: chunkPath,
            startTime: chunkStart,
            endTime: chunkEnd,
            duration: actualDuration,
            offset: currentStart // Offset for timestamp calculation
        });
        currentStart += chunkDuration;
        chunkIndex++;
    }
    console.log(`  Calculated ${chunks.length} chunks`);
    // Split video into chunks
    for (const chunk of chunks) {
        await new Promise((resolve, reject) => {
            ffmpeg(inputPath)
                .setStartTime(chunk.startTime)
                .setDuration(chunk.duration)
                .outputOptions([
                '-c:v copy',
                '-c:a copy',
                '-avoid_negative_ts make_zero',
                '-y'
            ])
                .output(chunk.path)
                .on('end', () => {
                console.log(`  ✓ Chunk ${chunk.index}: ${chunk.startTime.toFixed(1)}s - ${chunk.endTime.toFixed(1)}s`);
                resolve();
            })
                .on('error', (err) => {
                reject(new Error(`Failed to split chunk ${chunk.index}: ${err.message}`));
            })
                .run();
        });
    }
    console.log(`✅ Split into ${chunks.length} chunks`);
    return chunks;
}
/**
 * Merge timestamps from multiple chunks with offset calculation
 * Handles deduplication of overlapping regions
 *
 * @param chunkResults - Array of results from each chunk worker
 * @param overlapDuration - Overlap duration for deduplication (default: 10)
 * @returns Merged and deduplicated timestamps
 */
export function mergeChunkTimestamps(chunkResults, overlapDuration = 10) {
    console.log(`🔀 Merging timestamps from ${chunkResults.length} chunks...`);
    // Apply offset to each timestamp
    const allTimestamps = [];
    for (const { chunk, timestamps } of chunkResults) {
        for (const ts of timestamps) {
            // Convert chunk-local timestamp to global timestamp
            const globalTs = chunk.startTime + ts;
            // Skip timestamps in the leading overlap region (except for chunk 0)
            if (chunk.index > 0 && ts < overlapDuration) {
                continue; // This timestamp is in the overlap region, skip it
            }
            allTimestamps.push(globalTs);
        }
    }
    // Sort timestamps
    allTimestamps.sort((a, b) => a - b);
    // Deduplicate timestamps within overlap threshold
    const deduplicationThreshold = 0.5; // 500ms
    const deduplicated = [];
    for (const ts of allTimestamps) {
        const isDuplicate = deduplicated.some(existing => Math.abs(existing - ts) < deduplicationThreshold);
        if (!isDuplicate) {
            deduplicated.push(ts);
        }
    }
    console.log(`  Raw: ${allTimestamps.length} timestamps → Deduplicated: ${deduplicated.length}`);
    return deduplicated;
}
/**
 * Clean up chunk files
 * @param chunks - Array of VideoChunk to clean up
 */
export async function cleanupChunks(chunks) {
    if (chunks.length === 0)
        return;
    const outputDir = path.dirname(chunks[0].path);
    try {
        await fs.rm(outputDir, { recursive: true, force: true });
        console.log(`🧹 Cleaned up chunk files: ${outputDir}`);
    }
    catch (error) {
        console.error('⚠️ Error cleaning up chunks:', error);
    }
}
//# sourceMappingURL=ffmpeg.js.map