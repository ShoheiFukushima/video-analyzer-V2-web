/**
 * PySceneDetect Detector
 *
 * Node.js wrapper for PySceneDetect ContentDetector + DissolveDetector Python script.
 * Follows the same spawn pattern as transnetDetector.ts.
 *
 * ContentDetector: Detects hard cuts (abrupt scene changes)
 * DissolveDetector: Detects gradual transitions (dissolves, cross-fades) via skip-frame comparison
 *
 * @since 2026-02-18
 */

import { spawn } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import type { SceneCut } from '../types/excel.js';
import type { SceneDetectionProgressCallback } from './ffmpeg.js';

// ============================================================
// Types
// ============================================================

interface PySceneResult {
  timestamp: number;
  confidence: number;
  type?: 'hard_cut' | 'dissolve';
  dissolve_start?: number;
  dissolve_end?: number;
}

export interface TelopAnimation {
  region: string;   // "bottom" | "center_text" | "top_left" | "top_right"
  start: number;    // animation start time (seconds)
  settling: number; // animation settling time (seconds)
}

export interface PanAnimation {
  start: number;      // pan start time (seconds)
  settling: number;   // pan settling time (seconds)
  direction: 'horizontal' | 'vertical' | 'diagonal';
}

interface PySceneOutput {
  cuts: PySceneResult[];
  telop_animations: TelopAnimation[];
  pan_animations: PanAnimation[];
}

interface PySceneConfig {
  pythonPath: string;
  scriptPath: string;
  threshold: number;
  minSceneLen: number;
  timeoutMs: number;
  // Dissolve detection (dual-signal dip detection)
  dissolveEnabled: boolean;
  dissolveDipRatio: number;        // fraction below rolling median to qualify as dip
  dissolveWindowFrames: number;    // rolling median window size in sampled frames
  dissolveMinDipFrames: number;    // minimum dip duration in sampled frames
  dissolveMaxDipFrames: number;    // maximum dip duration in sampled frames
  dissolveFrameStep: number;       // subsample every N-th frame
}

// ============================================================
// Configuration
// ============================================================

const DEFAULT_CONFIG: PySceneConfig = {
  pythonPath: '/opt/venv/bin/python3',
  scriptPath: '/app/pysceneRunner.py',
  threshold: 40.0, // Higher threshold to reduce over-segmentation (target: 30-50 scenes)
  minSceneLen: 5, // 45→5: 最小5フレーム（≈0.17s@30fps）で1秒未満のカットも検出
  timeoutMs: 600000, // 10 minutes
  // Dissolve detection defaults (dual-signal dip detection)
  dissolveEnabled: false,
  dissolveDipRatio: 0.25,       // 25% below rolling median → "in dip"
  dissolveWindowFrames: 300,    // rolling median window (~20s @30fps with step=2); must be >> max dissolve duration
  dissolveMinDipFrames: 8,      // minimum dip duration (~0.5s @30fps with step=2)
  dissolveMaxDipFrames: 120,    // maximum dip duration (~8s @30fps with step=2)
  dissolveFrameStep: 2,         // subsample every 2nd frame for speed
};

function loadConfig(): PySceneConfig {
  return {
    pythonPath: process.env.PYSCENE_PYTHON_PATH || DEFAULT_CONFIG.pythonPath,
    scriptPath: process.env.PYSCENE_SCRIPT_PATH || DEFAULT_CONFIG.scriptPath,
    threshold: parseFloat(process.env.PYSCENE_THRESHOLD || String(DEFAULT_CONFIG.threshold)),
    minSceneLen: parseInt(process.env.PYSCENE_MIN_SCENE_LEN || String(DEFAULT_CONFIG.minSceneLen), 10),
    timeoutMs: parseInt(process.env.PYSCENE_TIMEOUT_MS || String(DEFAULT_CONFIG.timeoutMs), 10),
    dissolveEnabled: (process.env.DISSOLVE_DETECTION_ENABLED || String(DEFAULT_CONFIG.dissolveEnabled)).toLowerCase() === 'true',
    dissolveDipRatio: parseFloat(process.env.DISSOLVE_DIP_RATIO || String(DEFAULT_CONFIG.dissolveDipRatio)),
    dissolveWindowFrames: parseInt(process.env.DISSOLVE_WINDOW_FRAMES || String(DEFAULT_CONFIG.dissolveWindowFrames), 10),
    dissolveMinDipFrames: parseInt(process.env.DISSOLVE_MIN_DIP_FRAMES || String(DEFAULT_CONFIG.dissolveMinDipFrames), 10),
    dissolveMaxDipFrames: parseInt(process.env.DISSOLVE_MAX_DIP_FRAMES || String(DEFAULT_CONFIG.dissolveMaxDipFrames), 10),
    dissolveFrameStep: parseInt(process.env.DISSOLVE_FRAME_STEP || String(DEFAULT_CONFIG.dissolveFrameStep), 10),
  };
}

// ============================================================
// Core Detection
// ============================================================

/**
 * Detect scene cuts using PySceneDetect ContentDetector + optional DissolveDetector
 *
 * @param videoPath - Path to the video file
 * @param videoDuration - Video duration in seconds (for progress estimation)
 * @param onProgress - Optional progress callback
 * @returns Object with scene cuts array
 */
export async function detectWithPyScene(
  videoPath: string,
  videoDuration?: number,
  onProgress?: SceneDetectionProgressCallback
): Promise<{ cuts: SceneCut[]; telopAnimations: TelopAnimation[]; panAnimations: PanAnimation[] }> {
  const config = loadConfig();
  const startTime = Date.now();

  // Scale timeout based on video duration: minimum 10min, +1min per 5min of video
  // When dissolve detection is enabled, add extra time for the second pass
  if (videoDuration && videoDuration > 0) {
    const dissolveMultiplier = config.dissolveEnabled ? 1.5 : 1.0;
    const scaledTimeout = Math.max(
      config.timeoutMs,
      Math.ceil((600000 + Math.ceil(videoDuration / 300) * 60000) * dissolveMultiplier)
    );
    if (scaledTimeout > config.timeoutMs) {
      console.log(`  [PyScene] Scaling timeout for ${Math.round(videoDuration)}s video: ${config.timeoutMs / 1000}s → ${scaledTimeout / 1000}s`);
      config.timeoutMs = scaledTimeout;
    }
  }

  console.log(`🔍 [PyScene] Starting scene detection`);
  console.log(`  ContentDetector: threshold=${config.threshold}, minSceneLen=${config.minSceneLen}`);
  if (config.dissolveEnabled) {
    console.log(`  DissolveDetector: ENABLED (dipRatio=${config.dissolveDipRatio}, window=${config.dissolveWindowFrames}, minDip=${config.dissolveMinDipFrames}, maxDip=${config.dissolveMaxDipFrames}, frameStep=${config.dissolveFrameStep})`);
  } else {
    console.log(`  DissolveDetector: disabled (set DISSOLVE_DETECTION_ENABLED=true to enable)`);
  }
  console.log(`  timeout: ${config.timeoutMs / 1000}s`);

  const outputJson = path.join(
    os.tmpdir(),
    `pyscene_${Date.now()}_${Math.random().toString(36).slice(2)}.json`
  );

  // Timer-based progress estimation
  let timerInterval: NodeJS.Timeout | null = null;
  if (onProgress && videoDuration && videoDuration > 0) {
    // Dissolve detection adds a second pass, so estimate slower processing speed
    const estimatedSpeed = config.dissolveEnabled ? 15 : 30;
    timerInterval = setInterval(() => {
      const elapsed = (Date.now() - startTime) / 1000;
      const est = Math.min(elapsed * estimatedSpeed, videoDuration * 0.95);
      const formatT = (s: number) => {
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        const sec = Math.floor(s % 60);
        return h > 0
          ? `${h}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`
          : `${m}:${sec.toString().padStart(2, '0')}`;
      };
      onProgress(est, videoDuration, `${formatT(est)} / ${formatT(videoDuration)}`);
    }, 1000);
  }

  try {
    const { results, telopAnimations, panAnimations } = await runPySceneProcess(videoPath, outputJson, config);

    const cuts: SceneCut[] = results.map((r) => ({
      timestamp: Math.floor(r.timestamp * 1000) / 1000, // ミリ秒精度を保持（0.1s丸めによるカット消失を防止）
      confidence: r.confidence,
      ...(r.type === 'dissolve' ? { detectionReason: 'dissolve_transition' as const } : {}),
      ...(r.dissolve_start != null ? { dissolveStart: r.dissolve_start } : {}),
      ...(r.dissolve_end != null ? { dissolveEnd: r.dissolve_end } : {}),
    }));

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const hardCutCount = results.filter(r => r.type !== 'dissolve').length;
    const dissolveCount = results.filter(r => r.type === 'dissolve').length;

    if (dissolveCount > 0) {
      console.log(`✅ [PyScene] Detection complete: ${cuts.length} cuts (${hardCutCount} hard + ${dissolveCount} dissolve) in ${elapsed}s`);
    } else {
      console.log(`✅ [PyScene] Detection complete: ${cuts.length} cuts in ${elapsed}s`);
    }
    if (telopAnimations.length > 0) {
      console.log(`  🎯 [PyScene] Telop animations detected: ${telopAnimations.length} regions`);
      for (const ta of telopAnimations.slice(0, 5)) {
        console.log(`    ${ta.region}: ${ta.start.toFixed(2)}s → ${ta.settling.toFixed(2)}s`);
      }
      if (telopAnimations.length > 5) {
        console.log(`    ... and ${telopAnimations.length - 5} more`);
      }
    }
    if (panAnimations.length > 0) {
      console.log(`  📷 [PyScene] Camera pans detected: ${panAnimations.length} regions`);
      for (const pa of panAnimations.slice(0, 5)) {
        console.log(`    ${pa.direction}: ${pa.start.toFixed(2)}s → ${pa.settling.toFixed(2)}s`);
      }
      if (panAnimations.length > 5) {
        console.log(`    ... and ${panAnimations.length - 5} more`);
      }
    }

    return { cuts, telopAnimations, panAnimations };
  } finally {
    if (timerInterval) clearInterval(timerInterval);
    // Cleanup output file
    await fs.unlink(outputJson).catch(() => {});
  }
}

/**
 * Spawn the Python process and parse results
 */
function runPySceneProcess(
  videoPath: string,
  outputJson: string,
  config: PySceneConfig
): Promise<{ results: PySceneResult[]; telopAnimations: TelopAnimation[]; panAnimations: PanAnimation[] }> {
  return new Promise((resolve, reject) => {
    let completed = false;

    const args = [
      config.scriptPath,
      videoPath,
      outputJson,
      '--threshold', String(config.threshold),
      '--min-scene-len', String(config.minSceneLen),
    ];

    // Add dissolve detection args (dual-signal dip detection)
    if (config.dissolveEnabled) {
      args.push('--enable-dissolve');
      args.push('--dissolve-dip-ratio', String(config.dissolveDipRatio));
      args.push('--dissolve-window', String(config.dissolveWindowFrames));
      args.push('--dissolve-min-dip', String(config.dissolveMinDipFrames));
      args.push('--dissolve-max-dip', String(config.dissolveMaxDipFrames));
      args.push('--frame-step', String(config.dissolveFrameStep));
    }

    console.log(`  [PyScene] spawn: ${config.pythonPath} ${args.join(' ')}`);

    const proc = spawn(config.pythonPath, args, {
      timeout: config.timeoutMs,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';

    proc.stderr.on('data', (data: Buffer) => {
      const text = data.toString();
      stderr += text;
      // Forward PyScene logs
      for (const line of text.split('\n')) {
        if (line.trim()) console.log(`  ${line.trim()}`);
      }
    });

    proc.stdout.on('data', () => {
      // stdout not used, but drain it
    });

    const timeoutId = setTimeout(() => {
      if (!completed) {
        completed = true;
        proc.kill('SIGKILL');
        reject(new Error(`PySceneDetect timed out after ${config.timeoutMs / 1000}s`));
      }
    }, config.timeoutMs);

    proc.on('close', async (code) => {
      if (completed) return;
      completed = true;
      clearTimeout(timeoutId);

      if (code !== 0) {
        reject(new Error(`PySceneDetect exited with code ${code}: ${stderr.slice(-500)}`));
        return;
      }

      try {
        const jsonContent = await fs.readFile(outputJson, 'utf-8');
        const parsed = JSON.parse(jsonContent);
        // Support both array (legacy) and object (new) format
        const results: PySceneResult[] = Array.isArray(parsed) ? parsed : parsed.cuts;
        const telopAnimations: TelopAnimation[] = Array.isArray(parsed) ? [] : (parsed.telop_animations || []);
        const panAnimations: PanAnimation[] = Array.isArray(parsed) ? [] : (parsed.pan_animations || []);
        resolve({ results, telopAnimations, panAnimations });
      } catch (error) {
        reject(new Error(`Failed to parse PySceneDetect output: ${error}`));
      }
    });

    proc.on('error', (error) => {
      if (completed) return;
      completed = true;
      clearTimeout(timeoutId);
      reject(new Error(`Failed to spawn PySceneDetect: ${error.message}`));
    });
  });
}
