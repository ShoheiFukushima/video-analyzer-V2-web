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
/**
 * Transcription segment (from Whisper pipeline)
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
 * @param transcription - Transcription from whisperService
 * @returns Path to generated Excel file
 */
export declare function executeIdealPipeline(videoPath: string, projectTitle: string, transcription: TranscriptionSegment[]): Promise<{
    excelPath: string;
    stats: ProcessingStats;
}>;
export {};
//# sourceMappingURL=pipeline.d.ts.map