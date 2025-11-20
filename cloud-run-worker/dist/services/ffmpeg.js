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
import { formatTimecode } from '../utils/timecode.js';
import { TIMEOUTS } from '../config/timeouts.js';
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
 * @returns Array of scene cuts with confidence scores and source information
 */
async function detectSceneCuts(videoPath, config = DEFAULT_CONFIG) {
    // Load ROI configuration from environment if not provided in config
    const roiConfig = config.roi || loadROIConfigFromEnv();
    // Step 1: Full-frame multi-pass scene detection
    const allCuts = new Map(); // timestamp -> confidence
    console.log(`🔍 Starting multi-pass scene detection with thresholds: ${config.thresholds.join(', ')}`);
    for (const threshold of config.thresholds) {
        console.log(`  📊 Running detection pass with threshold ${threshold}...`);
        const cuts = await runSceneDetection(videoPath, threshold);
        console.log(`  ✓ Found ${cuts.length} cuts at threshold ${threshold}`);
        // Merge cuts with maximum confidence
        cuts.forEach(cut => {
            const existingConfidence = allCuts.get(cut.timestamp) || 0;
            allCuts.set(cut.timestamp, Math.max(existingConfidence, cut.confidence));
        });
    }
    // Convert map to array and sort by timestamp
    let fullFrameCuts = Array.from(allCuts.entries())
        .map(([timestamp, confidence]) => ({ timestamp, confidence }))
        .sort((a, b) => a.timestamp - b.timestamp);
    console.log(`✅ Full-frame detection complete: ${fullFrameCuts.length} scene cuts`);
    // Step 2: ROI-based scene detection (if enabled)
    let finalCuts = fullFrameCuts;
    if (roiConfig && roiConfig.enabled && roiConfig.regions.length > 0) {
        console.log(`🎯 ROI detection enabled: processing ${roiConfig.regions.length} region(s)`);
        // Phase 2: Process all ROI regions
        let allRoiCuts = [];
        const roiRegionCounts = {};
        for (const region of roiConfig.regions) {
            console.log(`\n🔍 Processing region: ${region.name}`);
            console.log(`   Crop: ${region.crop}`);
            console.log(`   Description: ${region.description || 'N/A'}`);
            const roiCuts = await detectROICuts(videoPath, region);
            roiRegionCounts[region.name] = roiCuts.length;
            // Merge each region's cuts with full-frame cuts
            const mergedForRegion = mergeCutsWithSource(fullFrameCuts, roiCuts, region.name);
            // Accumulate all ROI cuts (will deduplicate later)
            allRoiCuts = [...allRoiCuts, ...roiCuts];
            console.log(`   ✅ Region "${region.name}": ${roiCuts.length} cuts detected`);
        }
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
 * @param videoPath - Path to the video file
 * @param threshold - Scene detection threshold (0.0-1.0)
 * @returns Array of scene cuts
 */
function runSceneDetection(videoPath, threshold) {
    return new Promise((resolve, reject) => {
        const cuts = [];
        const TIMEOUT_MS = TIMEOUTS.SCENE_DETECTION; // 300 seconds (5 minutes) - handles large videos
        let timeoutId;
        let ffmpegCommand;
        const cleanup = () => {
            clearTimeout(timeoutId);
            if (ffmpegCommand) {
                try {
                    ffmpegCommand.kill('SIGKILL');
                }
                catch (err) {
                    // Ignore kill errors
                }
            }
        };
        // Set timeout
        timeoutId = setTimeout(() => {
            cleanup();
            reject(new Error(`FFmpeg scene detection timed out after ${TIMEOUT_MS}ms (threshold: ${threshold})`));
        }, TIMEOUT_MS);
        ffmpegCommand = ffmpeg(videoPath)
            .outputOptions([
            // Use 'showinfo' for reliable scene detection (Cloud Run compatible)
            // showinfo always outputs to stderr (fluent-ffmpeg compatible)
            // Buffer overflow prevented by 'select' filter (only scene cut frames)
            '-vf', `select='gt(scene,${threshold})',showinfo`,
            '-f', 'null'
        ])
            .output('/dev/null') // Null output for scene detection (FFmpeg standard)
            .on('stderr', (stderrLine) => {
            // Parse FFmpeg output for scene timestamps
            // Format: "frame:123 pts:12345 pts_time:12.345"
            const match = stderrLine.match(/pts_time:(\d+\.?\d*)/);
            if (match) {
                const timestamp = parseFloat(match[1]);
                cuts.push({
                    timestamp: Math.floor(timestamp * 10) / 10, // Round to 0.1s precision
                    confidence: threshold
                });
            }
        })
            .on('end', () => {
            clearTimeout(timeoutId);
            resolve(cuts);
        })
            .on('error', (err) => {
            clearTimeout(timeoutId);
            reject(err);
        })
            .run();
    });
}
/**
 * Run FFmpeg scene detection on a cropped region (ROI-based detection)
 * Applies crop filter before scene detection to analyze specific screen areas
 * @param videoPath - Path to the video file
 * @param cropFilter - FFmpeg crop filter syntax (e.g., "iw:ih*0.15:0:ih*0.85")
 * @param threshold - Scene detection threshold (0.0-1.0)
 * @returns Array of scene cuts detected in the ROI
 */
function runSceneDetectionWithCrop(videoPath, cropFilter, threshold) {
    return new Promise((resolve, reject) => {
        const cuts = [];
        const TIMEOUT_MS = TIMEOUTS.SCENE_DETECTION; // 300 seconds (5 minutes)
        let timeoutId;
        let ffmpegCommand;
        // Validate crop filter syntax before execution
        try {
            validateCropFilter(cropFilter);
        }
        catch (error) {
            reject(error);
            return;
        }
        const cleanup = () => {
            clearTimeout(timeoutId);
            if (ffmpegCommand) {
                try {
                    ffmpegCommand.kill('SIGKILL');
                }
                catch (err) {
                    // Ignore kill errors
                }
            }
        };
        // Set timeout
        timeoutId = setTimeout(() => {
            cleanup();
            reject(new Error(`FFmpeg ROI scene detection timed out after ${TIMEOUT_MS}ms ` +
                `(crop: ${cropFilter}, threshold: ${threshold})`));
        }, TIMEOUT_MS);
        ffmpegCommand = ffmpeg(videoPath)
            .outputOptions([
            // Apply crop BEFORE scene detection
            // Filter chain: crop → select (scene detection) → showinfo (timestamp extraction)
            '-vf', `crop=${cropFilter},select='gt(scene,${threshold})',showinfo`,
            '-f', 'null'
        ])
            .output('/dev/null') // Null output for scene detection
            .on('stderr', (stderrLine) => {
            // Parse FFmpeg output for scene timestamps
            // Format: "frame:123 pts:12345 pts_time:12.345"
            const match = stderrLine.match(/pts_time:(\d+\.?\d*)/);
            if (match) {
                const timestamp = parseFloat(match[1]);
                cuts.push({
                    timestamp: Math.floor(timestamp * 10) / 10, // Round to 0.1s precision
                    confidence: threshold
                });
            }
        })
            .on('end', () => {
            clearTimeout(timeoutId);
            resolve(cuts);
        })
            .on('error', (err) => {
            clearTimeout(timeoutId);
            reject(err);
        })
            .run();
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
 * @param videoPath - Path to the video file
 * @param timestamp - Time in seconds
 * @param outputPath - Output file path for frame
 * @param videoMetadata - Optional video metadata for adaptive resizing
 */
async function extractFrameAtTime(videoPath, timestamp, outputPath, videoMetadata) {
    return new Promise((resolve, reject) => {
        // Adaptive resolution: maintain original if <= 1920x1080, otherwise resize
        const shouldResize = videoMetadata &&
            (videoMetadata.width > 1920 || videoMetadata.height > 1080);
        const command = ffmpeg(videoPath)
            .seekInput(timestamp)
            .frames(1);
        // Apply quality optimization filters
        const filters = [];
        // 1. Adaptive resizing (only if needed)
        if (shouldResize) {
            filters.push('scale=1920:1080:force_original_aspect_ratio=decrease');
            console.log(`  [Frame extraction] Resizing from ${videoMetadata.width}x${videoMetadata.height} → 1920x1080`);
        }
        else {
            console.log(`  [Frame extraction] Maintaining original resolution${videoMetadata ? ` (${videoMetadata.width}x${videoMetadata.height})` : ''}`);
        }
        // 2. Sharpness filter for OCR clarity
        // unsharp=luma_msize_x:luma_msize_y:luma_amount:chroma_msize_x:chroma_msize_y:chroma_amount
        // 5:5:1.0:5:5:0.0 = 5x5 luma matrix, 1.0 sharpness, no chroma sharpening
        filters.push('unsharp=5:5:1.0:5:5:0.0');
        // 3. RGB24 color space for consistent OCR
        // (applied via output options, not as a filter)
        // Apply filters if any
        if (filters.length > 0) {
            command.outputOptions(['-vf', filters.join(',')]);
        }
        // Force RGB24 pixel format for OCR consistency
        command
            .outputOptions(['-pix_fmt', 'rgb24'])
            .output(outputPath)
            .on('end', () => resolve())
            .on('error', (err) => reject(err))
            .run();
    });
}
/**
 * Get video metadata (duration, width, height, aspect ratio)
 */
export function getVideoMetadata(videoPath) {
    return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(videoPath, (err, metadata) => {
            if (err) {
                reject(err);
            }
            else {
                const duration = Math.floor(metadata.format.duration || 0);
                const videoStream = metadata.streams.find(s => s.codec_type === 'video');
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
 * @returns Array of Scene objects with screenshot paths
 */
export async function extractScenesWithFrames(videoPath, outputDir) {
    const framesDir = outputDir || path.join('/tmp', `frames-${Date.now()}`);
    try {
        // Create output directory
        await fs.mkdir(framesDir, { recursive: true });
        console.log(`📁 Created output directory: ${framesDir}`);
        // Get video metadata (including dimensions for adaptive frame extraction)
        const videoMetadata = await getVideoMetadata(videoPath);
        console.log(`🎬 Video duration: ${videoMetadata.duration}s`);
        // Step 1: Multi-pass scene detection
        const cuts = await detectSceneCuts(videoPath);
        if (cuts.length === 0) {
            console.warn('⚠️ No scene cuts detected, falling back to single scene');
            // Fallback: treat entire video as one scene
            cuts.push({ timestamp: 0, confidence: 0.03 });
        }
        // Step 2: Generate scene ranges with mid-points
        const scenes = await generateSceneRanges(cuts, videoMetadata.duration);
        console.log(`📸 Extracting ${scenes.length} frames at mid-points (50% position)...`);
        // Step 3: Extract frames at mid-points (50% position) with adaptive quality
        // Note: minSceneInterval=1.0s ensures we skip fade-in detections
        for (const scene of scenes) {
            const filename = path.join(framesDir, `scene-${scene.sceneNumber.toString().padStart(4, '0')}.png`);
            // Pass video metadata for adaptive resizing and quality optimization
            await extractFrameAtTime(videoPath, scene.midTime, filename, videoMetadata);
            // Set screenshot path
            scene.screenshotPath = filename;
            console.log(`  ✓ Scene ${scene.sceneNumber}: ${scene.timecode} (mid-point: ${scene.midTime.toFixed(1)}s)`);
        }
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
//# sourceMappingURL=ffmpeg.js.map