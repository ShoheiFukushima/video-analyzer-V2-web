/**
 * Excel Output Data Structures
 * Defines interfaces for the ideal Excel output format
 */

/**
 * Represents a single row in the final Excel output
 * Columns: Scene # | Timecode | Screenshot | OCR Text | NA Text
 */
export interface ExcelRow {
  /** Scene number (sequential: 1, 2, 3...) */
  sceneNumber: number;

  /** Timecode in HH:MM:SS format (scene change timestamp) */
  timecode: string;

  /** Path to extracted frame PNG file */
  screenshotPath: string;

  /** Text detected by OCR (Gemini Vision) */
  ocrText: string;

  /** Narration text from audio transcription (Whisper) */
  narrationText: string;
}

/**
 * Video metadata for Excel formatting
 */
export interface VideoMetadata {
  /** Video width in pixels */
  width: number;

  /** Video height in pixels */
  height: number;

  /** Aspect ratio (width / height, e.g., 1.777 for 16:9) */
  aspectRatio: number;

  /** Total video duration in seconds */
  duration: number;
}

/**
 * Scene information from FFmpeg detection
 */
export interface Scene {
  /** Scene number (sequential: 1, 2, 3...) */
  sceneNumber: number;

  /** Scene change detection point (seconds) */
  startTime: number;

  /** Next scene change point (seconds) */
  endTime: number;

  /** Mid-point for screenshot extraction (startTime + endTime) / 2 */
  midTime: number;

  /** Timecode in HH:MM:SS format at startTime */
  timecode: string;

  /** Path to extracted screenshot (set after frame extraction) */
  screenshotPath?: string;
}

/**
 * Scene cut detection result from FFmpeg
 */
export interface SceneCut {
  /** Timestamp of scene change in seconds */
  timestamp: number;

  /** Detection confidence (FFmpeg threshold: 0.03-0.10) */
  confidence: number;
}

/**
 * Excel generation options
 */
export interface ExcelGenerationOptions {
  /** Project/video title */
  projectTitle: string;

  /** Array of Excel rows to generate */
  rows: ExcelRow[];

  /** Video metadata for image sizing */
  videoMetadata: VideoMetadata;

  /** Include processing statistics sheet (optional) */
  includeStatistics?: boolean;
}

/**
 * Processing statistics for Excel stats sheet
 */
export interface ProcessingStats {
  /** Total number of scenes processed */
  totalScenes: number;

  /** Number of scenes with OCR text detected */
  scenesWithOCRText: number;

  /** Number of scenes with narration */
  scenesWithNarration: number;

  /** Total processing time in milliseconds */
  processingTimeMs: number;

  /** Estimated cost (USD) */
  estimatedCost?: number;

  /** Video metadata */
  videoMetadata?: VideoMetadata;
}
