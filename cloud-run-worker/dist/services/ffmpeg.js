import { exec } from 'child_process';
import { promisify } from 'util';
import { promises as fs } from 'fs';
import path from 'path';
const execAsync = promisify(exec);
const DEFAULT_CONFIG = {
    thresholds: [0.03, 0.05, 0.10], // Multi-pass detection for maximum accuracy
    minSceneDuration: 0.5 // Filter out very short scenes
};
export async function extractMetadata(videoPath) {
    try {
        const command = `ffprobe -v quiet -print_format json -show_format -show_streams "${videoPath}"`;
        const { stdout } = await execAsync(command);
        const probeData = JSON.parse(stdout);
        const videoStream = probeData.streams?.find((s) => s.codec_type === 'video');
        const format = probeData.format;
        const width = videoStream?.width || 1920;
        const height = videoStream?.height || 1080;

        // Extract rotation metadata (common in smartphone videos)
        const rotationTag = videoStream?.tags?.rotate ||
                           videoStream?.side_data_list?.find(d => d.rotation)?.rotation ||
                           '0';
        const rotation = Math.abs(parseInt(rotationTag));

        // Swap width/height if video is rotated 90 or 270 degrees (portrait mode)
        const isPortrait = rotation === 90 || rotation === 270;
        const displayWidth = isPortrait ? height : width;
        const displayHeight = isPortrait ? width : height;
        const aspectRatio = displayWidth / displayHeight;

        return {
            duration: parseFloat(format.duration) || 0,
            width: displayWidth,
            height: displayHeight,
            resolution: `${displayWidth}x${displayHeight}`,
            codec: videoStream?.codec_name || 'h264',
            bitrate: parseInt(format.bit_rate) || 0,
            fps: videoStream?.r_frame_rate ? evaluateFraction(videoStream.r_frame_rate) : 30,
            fileSize: parseInt(format.size) || 0,
            aspectRatio,
            rotation, // Add rotation info for frame extraction
        };
    }
    catch (error) {
        console.warn('Metadata extraction failed, using defaults:', error);
        return {
            duration: 0,
            width: 1920,
            height: 1080,
            resolution: '1920x1080',
            codec: 'unknown',
            bitrate: 0,
            fps: 30,
            fileSize: 0,
            aspectRatio: 16 / 9,
            rotation: 0,
        };
    }
}
function evaluateFraction(fraction) {
    const [num, denom] = fraction.split('/').map(Number);
    return denom ? num / denom : num;
}
/**
 * Format seconds to HH:MM:SS timecode
 */
function formatTimecode(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}
/**
 * Run FFmpeg scene detection with single threshold
 */
async function runSceneDetection(videoPath, threshold) {
    const cuts = [];
    try {
        // Use ffmpeg scene detection filter and capture stderr output
        const command = `ffmpeg -i "${videoPath}" -vf "select='gt(scene,${threshold})',showinfo" -f null - 2>&1`;
        // Increased maxBuffer to 50MB for high-resolution videos
        const { stdout } = await execAsync(command, { maxBuffer: 50 * 1024 * 1024, timeout: 600000 });
        // Parse FFmpeg output for scene timestamps
        const lines = stdout.split('\n');
        for (const line of lines) {
            const match = line.match(/pts_time:(\d+\.?\d*)/);
            if (match) {
                const timestamp = parseFloat(match[1]);
                cuts.push({
                    timestamp: Math.floor(timestamp * 10) / 10, // Round to 0.1s precision
                    confidence: threshold
                });
            }
        }
    }
    catch (error) {
        // FFmpeg writes to stderr even on success, so we need to check the actual error
        if (error.stdout) {
            const lines = error.stdout.split('\n');
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
        }
    }
    return cuts;
}
/**
 * Multi-pass FFmpeg scene detection
 */
async function detectSceneCuts(videoPath, config = DEFAULT_CONFIG) {
    const allCuts = new Map();
    console.log(`🔍 Starting multi-pass scene detection with thresholds: ${config.thresholds.join(', ')}`);
    for (const threshold of config.thresholds) {
        console.log(`  📊 Running detection pass with threshold ${threshold}...`);
        const cuts = await runSceneDetection(videoPath, threshold);
        console.log(`  ✓ Found ${cuts.length} cuts at threshold ${threshold}`);
        cuts.forEach(cut => {
            const existingConfidence = allCuts.get(cut.timestamp) || 0;
            allCuts.set(cut.timestamp, Math.max(existingConfidence, cut.confidence));
        });
    }
    const mergedCuts = Array.from(allCuts.entries())
        .map(([timestamp, confidence]) => ({ timestamp, confidence }))
        .sort((a, b) => a.timestamp - b.timestamp);
    console.log(`✅ Multi-pass detection complete: ${mergedCuts.length} total scene cuts`);
    return mergedCuts;
}
/**
 * Generate scene ranges from detected cuts
 */
async function generateSceneRanges(cuts, videoDuration, config = DEFAULT_CONFIG) {
    const scenes = [];
    let sceneNumber = 1;
    console.log(`📐 Generating scene ranges from ${cuts.length} cuts...`);
    for (let i = 0; i < cuts.length; i++) {
        const startTime = cuts[i].timestamp;
        const endTime = i < cuts.length - 1 ? cuts[i + 1].timestamp : videoDuration;
        const duration = endTime - startTime;
        if (duration < config.minSceneDuration) {
            console.log(`  ⏭️  Skipping short scene (${duration.toFixed(2)}s < ${config.minSceneDuration}s)`);
            continue;
        }
        const midTime = (startTime + endTime) / 2;
        scenes.push({
            sceneNumber,
            startTime,
            endTime,
            midTime,
            timecode: formatTimecode(startTime)
        });
        sceneNumber++;
    }
    console.log(`✅ Generated ${scenes.length} valid scene ranges`);
    return scenes;
}
/**
 * Extract frame at specific timestamp with aspect ratio preservation and rotation
 */
async function extractFrameAtTime(videoPath, timestamp, outputPath, metadata) {
    // Build video filter for scaling and rotation
    const maxWidth = 1280;
    const maxHeight = 720;

    // Scale filter that maintains aspect ratio
    const scaleFilter = `scale='min(${maxWidth}\\,iw)':'min(${maxHeight}\\,ih)':force_original_aspect_ratio=decrease`;

    // Rotation filter for smartphone videos
    let rotationFilter = '';
    if (metadata.rotation === 90) {
        rotationFilter = ',transpose=1'; // 90 degrees clockwise
    } else if (metadata.rotation === 270) {
        rotationFilter = ',transpose=2'; // 90 degrees counter-clockwise
    } else if (metadata.rotation === 180) {
        rotationFilter = ',hflip,vflip'; // 180 degrees
    }

    const videoFilter = `${scaleFilter}${rotationFilter}`;
    const command = `ffmpeg -ss ${timestamp} -i "${videoPath}" -vf "${videoFilter}" -frames:v 1 "${outputPath}" -y`;

    try {
        await execAsync(command);
    }
    catch (error) {
        // FFmpeg may write to stderr even on success
        if (error.code !== 0) {
            throw error;
        }
    }
}
/**
 * Main frame extraction function
 * Implements FFmpeg scene detection + mid-point frame extraction
 */
export async function extractFrames(videoPath) {
    const outputDir = path.join('/tmp', `frames-${Date.now()}`);
    try {
        await fs.mkdir(outputDir, { recursive: true });
        console.log(`📁 Created output directory: ${outputDir}`);
        const metadata = await extractMetadata(videoPath);
        const duration = metadata.duration;
        console.log(`🎬 Video duration: ${duration}s, rotation: ${metadata.rotation}°`);
        const cuts = await detectSceneCuts(videoPath);
        if (cuts.length === 0) {
            console.warn('⚠️ No scene cuts detected, falling back to single scene');
            cuts.push({ timestamp: 0, confidence: 0.03 });
        }
        const scenes = await generateSceneRanges(cuts, duration);
        console.log(`📸 Extracting ${scenes.length} frames at mid-points...`);
        const frames = [];
        for (const scene of scenes) {
            const filename = path.join(outputDir, `scene-${scene.sceneNumber.toString().padStart(4, '0')}.jpg`);
            await extractFrameAtTime(videoPath, scene.midTime, filename, metadata);
            frames.push({
                filename,
                timecode: scene.timecode,
                timestamp: scene.startTime,
                sceneNumber: scene.sceneNumber
            });
            console.log(`  ✓ Scene ${scene.sceneNumber}: ${scene.timecode} (mid-point: ${scene.midTime.toFixed(1)}s)`);
        }
        console.log(`✅ Extracted ${frames.length} frames at mid-points`);
        return frames;
    }
    catch (error) {
        try {
            await fs.rm(outputDir, { recursive: true, force: true });
        }
        catch (cleanupError) {
            console.error('⚠️ Cleanup error:', cleanupError);
        }
        throw error;
    }
}
/**
 * Voice Activity Detection (VAD) using FFmpeg volumedetect
 * Returns true if audio is detected, false otherwise
 */
export async function detectAudioActivity(videoPath) {
    try {
        console.log('🎤 Running Voice Activity Detection (VAD)...');
        // Use FFmpeg volumedetect filter to analyze audio levels
        const command = `ffmpeg -i "${videoPath}" -af volumedetect -f null - 2>&1`;
        // Increased maxBuffer to 50MB for high-resolution videos
        const { stdout } = await execAsync(command, { maxBuffer: 50 * 1024 * 1024, timeout: 300000 });
        // Parse volumedetect output
        // Example output:
        // [Parsed_volumedetect_0 @ 0x...] mean_volume: -25.3 dB
        // [Parsed_volumedetect_0 @ 0x...] max_volume: -5.1 dB
        const meanVolumeMatch = stdout.match(/mean_volume:\s*(-?\d+\.?\d*)\s*dB/);
        const maxVolumeMatch = stdout.match(/max_volume:\s*(-?\d+\.?\d*)\s*dB/);
        if (!meanVolumeMatch || !maxVolumeMatch) {
            console.warn('⚠️ Could not parse audio volume data, assuming audio exists');
            return true; // Default to true if parsing fails
        }
        const meanVolume = parseFloat(meanVolumeMatch[1]);
        const maxVolume = parseFloat(maxVolumeMatch[1]);
        // Thresholds for audio detection (adjusted for smartphone videos):
        // - mean_volume > -70 dB: Lower threshold for phone-recorded audio with AGC
        // - max_volume > -60 dB: Lower threshold for quiet recordings
        // Smartphone microphones apply automatic gain control (AGC) which can result in lower volume levels
        const MEAN_VOLUME_THRESHOLD = -70;
        const MAX_VOLUME_THRESHOLD = -60;
        const hasAudio = meanVolume > MEAN_VOLUME_THRESHOLD && maxVolume > MAX_VOLUME_THRESHOLD;
        console.log(`  📊 Audio levels: mean=${meanVolume.toFixed(1)}dB, max=${maxVolume.toFixed(1)}dB`);
        console.log(`  ${hasAudio ? '✅ Audio detected' : '❌ No audio detected (silent video)'}`);
        return hasAudio;
    }
    catch (error) {
        // Check if error output contains volume data (FFmpeg writes to stderr)
        if (error.stdout) {
            const meanVolumeMatch = error.stdout.match(/mean_volume:\s*(-?\d+\.?\d*)\s*dB/);
            const maxVolumeMatch = error.stdout.match(/max_volume:\s*(-?\d+\.?\d*)\s*dB/);
            if (meanVolumeMatch && maxVolumeMatch) {
                const meanVolume = parseFloat(meanVolumeMatch[1]);
                const maxVolume = parseFloat(maxVolumeMatch[1]);
                // Same thresholds as above for smartphone audio
                const MEAN_VOLUME_THRESHOLD = -70;
                const MAX_VOLUME_THRESHOLD = -60;
                const hasAudio = meanVolume > MEAN_VOLUME_THRESHOLD && maxVolume > MAX_VOLUME_THRESHOLD;
                console.log(`  📊 Audio levels: mean=${meanVolume.toFixed(1)}dB, max=${maxVolume.toFixed(1)}dB`);
                console.log(`  ${hasAudio ? '✅ Audio detected' : '❌ No audio detected (silent video)'}`);
                return hasAudio;
            }
        }
        console.warn('⚠️ VAD error, assuming audio exists:', error.message);
        return true; // Default to true on error
    }
}
/**
 * Clean up temporary frame files
 */
export async function cleanupFrames(frames) {
    if (frames.length === 0)
        return;
    const outputDir = path.dirname(frames[0].filename);
    try {
        await fs.rm(outputDir, { recursive: true, force: true });
        console.log(`🧹 Cleaned up temporary frames: ${outputDir}`);
    }
    catch (error) {
        console.error('⚠️ Error cleaning up frames:', error);
    }
}
