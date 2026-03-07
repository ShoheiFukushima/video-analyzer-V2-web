/**
 * Topic Grouping Service
 *
 * Groups consecutive scenes with similar OCR text into "topics".
 * Uses character bigram Jaccard similarity to determine if adjacent
 * scenes belong to the same topic.
 *
 * Design decisions:
 * - Empty OCR texts do NOT merge with each other (treated as cut changes)
 * - Similarity threshold: 0.6 (tuned for Japanese OCR text)
 * - Output: TopicGroup[] for Excel "Topics" sheet
 *
 * @since 2026-02-18
 */

import { TopicGroup } from '../types/excel.js';
import { formatTimecode } from '../utils/timecode.js';

// ============================================================
// Types
// ============================================================

export interface SceneForGrouping {
  sceneNumber: number;
  startTime: number;
  endTime: number;
  ocr: string;
  narration: string;
}

// ============================================================
// Configuration
// ============================================================

const SIMILARITY_THRESHOLD = 0.6;

// ============================================================
// Similarity
// ============================================================

/**
 * Extract character bigrams from a string.
 * Whitespace is normalized and trimmed before extraction.
 */
function bigrams(text: string): Set<string> {
  const normalized = text.replace(/\s+/g, ' ').trim();
  const result = new Set<string>();
  for (let i = 0; i < normalized.length - 1; i++) {
    result.add(normalized.substring(i, i + 2));
  }
  return result;
}

/**
 * Jaccard similarity between two sets of bigrams.
 * Returns 0 if either set is empty.
 */
function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;

  let intersection = 0;
  for (const item of a) {
    if (b.has(item)) intersection++;
  }

  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// ============================================================
// Core
// ============================================================

/**
 * Group consecutive scenes by OCR text similarity.
 *
 * @param scenes - Scenes with OCR and narration text (after LLM cleansing)
 * @param threshold - Jaccard similarity threshold (default: 0.6)
 * @returns Array of topic groups
 */
export function groupScenesByTopic(
  scenes: SceneForGrouping[],
  threshold: number = SIMILARITY_THRESHOLD
): TopicGroup[] {
  if (scenes.length === 0) return [];

  console.log(`📚 [Topic Grouping] Starting (${scenes.length} scenes, threshold: ${threshold})`);

  // Build groups of consecutive similar scenes
  const rawGroups: SceneForGrouping[][] = [];
  let currentGroup: SceneForGrouping[] = [scenes[0]];

  for (let i = 1; i < scenes.length; i++) {
    const prev = scenes[i - 1];
    const curr = scenes[i];

    const prevOcr = prev.ocr.trim();
    const currOcr = curr.ocr.trim();

    // Empty OCR texts do not merge (treat as cut boundaries)
    if (prevOcr.length === 0 && currOcr.length === 0) {
      rawGroups.push(currentGroup);
      currentGroup = [curr];
      continue;
    }

    // Check similarity
    const sim = jaccardSimilarity(bigrams(prevOcr), bigrams(currOcr));

    if (sim >= threshold) {
      currentGroup.push(curr);
    } else {
      rawGroups.push(currentGroup);
      currentGroup = [curr];
    }
  }
  rawGroups.push(currentGroup);

  // Assemble TopicGroup output
  const groups: TopicGroup[] = rawGroups.map((group, idx) =>
    assembleGroup(group, idx + 1)
  );

  // Log summary
  const multiSceneGroups = groups.filter(g => g.count > 1).length;
  console.log(`📚 [Topic Grouping] Done: ${groups.length} topics (${multiSceneGroups} multi-scene groups)`);

  return groups;
}

/**
 * Assemble a TopicGroup from a set of consecutive scenes.
 */
function assembleGroup(scenes: SceneForGrouping[], groupNumber: number): TopicGroup {
  const first = scenes[0];
  const last = scenes[scenes.length - 1];

  // Scene range
  const sceneRange = scenes.length === 1
    ? `${first.sceneNumber}`
    : `${first.sceneNumber}-${last.sceneNumber}`;

  // Time range
  const timeRange = `${formatTimecode(first.startTime)} - ${formatTimecode(last.endTime)}`;

  // OCR: pick the longest OCR text as representative
  let bestOcr = '';
  for (const s of scenes) {
    if (s.ocr.trim().length > bestOcr.length) {
      bestOcr = s.ocr.trim();
    }
  }

  // Narration: concatenate unique narration texts
  const narrationParts: string[] = [];
  for (const s of scenes) {
    const n = s.narration.trim();
    if (n.length > 0 && !narrationParts.includes(n)) {
      narrationParts.push(n);
    }
  }

  return {
    groupNumber,
    sceneRange,
    timeRange,
    count: scenes.length,
    ocr: bestOcr,
    narration: narrationParts.join(' '),
  };
}
