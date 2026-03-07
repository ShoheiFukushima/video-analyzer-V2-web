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
export interface SceneForGrouping {
    sceneNumber: number;
    startTime: number;
    endTime: number;
    ocr: string;
    narration: string;
}
/**
 * Group consecutive scenes by OCR text similarity.
 *
 * @param scenes - Scenes with OCR and narration text (after LLM cleansing)
 * @param threshold - Jaccard similarity threshold (default: 0.6)
 * @returns Array of topic groups
 */
export declare function groupScenesByTopic(scenes: SceneForGrouping[], threshold?: number): TopicGroup[];
//# sourceMappingURL=topicGrouping.d.ts.map