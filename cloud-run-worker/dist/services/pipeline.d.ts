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
import { Scene, VideoMetadata, ProcessingStats } from '../types/excel.js';
import type { TranscriptionSegment } from '../types/shared.js';
import { WarningCollector } from './warningCollector.js';
import { type ProcessingCheckpoint } from './checkpointService.js';
/**
 * Main pipeline execution
 * @param videoPath - Path to video file
 * @param projectTitle - Project/video title
 * @param transcription - Transcription from whisperService
 * @param uploadId - Optional upload ID for progress tracking
 * @param checkpoint - Optional checkpoint for resumable processing
 * @returns Path to generated Excel file
 */
export declare function executeIdealPipeline(videoPath: string, projectTitle: string, transcription: TranscriptionSegment[], uploadId?: string, checkpoint?: ProcessingCheckpoint, preDetectedScenes?: Scene[], videoMetadata?: VideoMetadata, warningCollector?: WarningCollector): Promise<{
    excelPath: string;
    stats: ProcessingStats;
}>;
/**
 * Extended Scene interface with OCR
 */
export interface SceneWithOCR extends Scene {
    ocrText: string;
    ocrConfidence: number;
}
/**
 * Extended Scene interface with OCR and narration
 */
export interface SceneWithNarration extends SceneWithOCR {
    narrationText: string;
}
//# sourceMappingURL=pipeline.d.ts.map