/**
 * Integrated Video Analysis Pipeline
 * FFmpeg Scene Detection → OCR → Narration Mapping → Excel Generation
 *
 * Implements the ideal workflow for V2:
 * 1. Scene detection with mid-point frame extraction
 * 2. OCR on each scene frame (Gemini Vision)
 * 3. Map narration to scenes based on timestamps
 * 4. Generate Excel with ideal format (Scene # | Timecode | Screenshot | OCR | NA Text)
 */
import { ProcessingStats } from '../types/excel.js';
import type { TranscriptionSegment, DetectionMode } from '../types/shared.js';
import { type ProcessingCheckpoint } from './checkpointService.js';
/**
 * Main pipeline execution
 * @param videoPath - Path to video file
 * @param projectTitle - Project/video title
 * @param transcription - Transcription from whisperService
 * @param uploadId - Optional upload ID for progress tracking
 * @param detectionMode - Detection mode ('standard' or 'enhanced')
 * @param checkpoint - Optional checkpoint for resumable processing
 * @returns Path to generated Excel file
 */
export declare function executeIdealPipeline(videoPath: string, projectTitle: string, transcription: TranscriptionSegment[], uploadId?: string, detectionMode?: DetectionMode, checkpoint?: ProcessingCheckpoint): Promise<{
    excelPath: string;
    stats: ProcessingStats;
}>;
//# sourceMappingURL=pipeline.d.ts.map