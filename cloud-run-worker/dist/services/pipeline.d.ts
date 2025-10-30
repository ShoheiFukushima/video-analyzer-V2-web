/**
 * Integrated Video Analysis Pipeline
 * FFmpeg Scene Detection → OCR → Narration Mapping → Excel Generation
 *
 * Implements the ideal workflow for V2:
 * 1. Scene detection with mid-point frame extraction
 * 2. OCR on each scene frame
 * 3. Map narration to scenes based on timestamps
 * 4. Generate Excel with ideal format (Scene # | Timecode | Screenshot | OCR | NA Text)
 */
import { ProcessingStats } from '../types/excel.js';
/**
 * OCR service result (from existing ocrService.ts)
 */
interface OCRResult {
    timestamp: number;
    frameIndex: number;
    text: string;
    confidence: number;
}
/**
 * Transcription segment (from existing whisperService.ts)
 */
interface TranscriptionSegment {
    timestamp: number;
    duration: number;
    text: string;
    confidence: number;
}
/**
 * Main pipeline execution
 * @param videoPath - Path to video file
 * @param projectTitle - Project/video title
 * @param ocrResults - OCR results from ocrService
 * @param transcription - Transcription from whisperService
 * @returns Path to generated Excel file
 */
export declare function executeIdealPipeline(videoPath: string, projectTitle: string, ocrResults: OCRResult[], transcription: TranscriptionSegment[]): Promise<{
    excelPath: string;
    stats: ProcessingStats;
}>;
export {};
//# sourceMappingURL=pipeline.d.ts.map