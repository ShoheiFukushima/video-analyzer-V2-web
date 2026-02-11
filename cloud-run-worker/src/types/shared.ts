/**
 * Shared Type Definitions
 *
 * Common types used across frontend and backend to ensure type consistency.
 */

// ========================================
// Detection Mode Types
// ========================================

/**
 * Video detection mode
 * - standard: Fast processing, detects hard cuts only
 * - enhanced: Better for fades, dissolves, text animations (slower)
 */
export type DetectionMode = 'standard' | 'enhanced';

/**
 * Detection mode descriptions for UI
 */
export const DETECTION_MODE_INFO: Record<DetectionMode, { label: string; description: string }> = {
  standard: {
    label: 'Standard',
    description: 'Fast processing, works well for most videos with hard cuts'
  },
  enhanced: {
    label: 'Enhanced',
    description: 'Better for fades, dissolves, text animations (2-3x processing time)'
  }
};

// ========================================
// Processing Status Types
// ========================================

export type ProcessingStatusType = 'pending' | 'processing' | 'completed' | 'error';

// ========================================
// 3-Phase Processing Types
// ========================================

/**
 * Processing phase (1-3)
 * Phase 1: Listening to narration (download → audio → Whisper)
 * Phase 2: Reading on-screen text (scene detection → frame extraction → OCR)
 * Phase 3: Creating report (narration mapping → Excel → upload)
 */
export type ProcessingPhase = 1 | 2 | 3;

/**
 * Phase status
 */
export type PhaseStatus = 'waiting' | 'in_progress' | 'completed' | 'skipped';

/**
 * Phase information for UI display
 */
export interface PhaseInfo {
  phase: ProcessingPhase;
  status: PhaseStatus;
  progress: number;           // 0-100 within this phase
  label: string;              // e.g., "Listening to narration..."
  estimatedTime?: string;     // e.g., "About 2-3 min (estimate)"
  subTask?: string;           // e.g., "Processing chunk 45/240"
}

export type ProcessingStage =
  | 'downloading'
  | 'compressing'
  | 'metadata'
  | 'audio'
  | 'audio_skipped'
  | 'vad_whisper'
  | 'luminance_detection'
  | 'text_stabilization'
  | 'scene_ocr_excel'        // @deprecated - Use scene_detection, ocr_processing, excel_generation instead
  | 'scene_detection'        // シーン検出中 (60-67%)
  | 'frame_extraction'       // フレーム抽出中 (67-70%)
  | 'multi_frame_ocr'
  | 'ocr_processing'         // OCR処理中 (70-85%)
  | 'ocr_completed'
  | 'batch_processing'       // バッチ処理中（メモリ最適化モード）- フレーム抽出+OCR+クリーンアップを反復
  | 'narration_mapping'      // ナレーションマッピング中 (85-87%)
  | 'excel_generation'       // Excel生成中 (87-90%)
  | 'upload_result'
  | 'completed';

export interface ProcessingMetadata {
  duration: number;
  segmentCount: number;
  ocrResultCount: number;
  transcriptionLength: number;
  totalScenes?: number;
  scenesWithOCR?: number;
  scenesWithNarration?: number;
  resultR2Key?: string; // Production only - R2 key for result file download
  blobUrl?: string; // @deprecated - Use resultR2Key instead
  detectionMode?: DetectionMode;
  luminanceTransitionsDetected?: number;
  textStabilizationPoints?: number;
}

export interface ProcessingStatus {
  uploadId: string;
  userId?: string;
  status: ProcessingStatusType;
  progress: number;
  stage?: ProcessingStage;
  message?: string;
  startedAt: string;
  updatedAt: string;
  resultUrl?: string;
  metadata?: ProcessingMetadata;
  error?: string;
  // 3-Phase UI support
  phase?: ProcessingPhase;
  phaseProgress?: number;      // 0-100 within current phase
  phaseStatus?: PhaseStatus;
  estimatedTimeRemaining?: string;  // e.g., "About 2-3 min (estimate)"
  subTask?: string;            // e.g., "Processing chunk 45/240"
}

// ========================================
// Supabase Types
// ========================================

export interface SupabaseError {
  code?: string;
  message: string;
  details?: string;
  hint?: string;
}

export interface SupabaseStatusUpdate {
  updated_at: string;
  status?: ProcessingStatusType;
  progress?: number;
  stage?: ProcessingStage;
  message?: string;
  result_url?: string;
  error?: string;
  metadata?: ProcessingMetadata;
  // 3-Phase UI support
  phase?: ProcessingPhase;
  phase_progress?: number;
  phase_status?: PhaseStatus;
  estimated_time_remaining?: string;
  sub_task?: string;
}

export interface SupabaseStatusRow {
  upload_id: string;
  user_id?: string;
  status: ProcessingStatusType;
  progress: number;
  stage?: ProcessingStage;
  message?: string;
  started_at: string;
  updated_at: string;
  result_url?: string;
  metadata?: ProcessingMetadata;
  error?: string;
  // 3-Phase UI support
  phase?: ProcessingPhase;
  phase_progress?: number;
  phase_status?: PhaseStatus;
  estimated_time_remaining?: string;
  sub_task?: string;
}

// ========================================
// Whisper API Types
// ========================================

export interface WhisperSegment {
  id: number;
  seek: number;
  start: number;
  end: number;
  text: string;
  tokens: number[];
  temperature: number;
  avg_logprob: number;
  compression_ratio: number;
  no_speech_prob: number;
}

export interface WhisperResponse {
  task: string;
  language: string;
  duration: number;
  text: string;
  segments: WhisperSegment[];
}

/**
 * Simplified transcription segment used in pipeline processing
 * (derived from WhisperSegment but with simplified structure)
 */
export interface TranscriptionSegment {
  /** Start time in seconds (absolute) */
  timestamp: number;
  /** Duration in seconds */
  duration: number;
  /** Transcribed text */
  text: string;
  /** Confidence score (0-1) */
  confidence: number;
  /** Which audio chunk this came from (optional) */
  chunkIndex?: number;
}

// ========================================
// VAD Types
// ========================================

export interface VADStats {
  totalDuration: number;
  voiceDuration: number;
  voiceRatio: number;
  estimatedSavings: number;
  chunksProcessed: number;
}

export interface VADChunk {
  path: string;
  startTime: number;
  endTime: number;
}

// ========================================
// Video Processing Types
// ========================================

export interface VideoMetadata {
  duration: number;
  width: number;
  height: number;
  aspectRatio: number;
  fps?: number;
  codec?: string;
}

export interface CompressionResult {
  compressed: boolean;
  originalSize: number;
  newSize: number;
}

// ========================================
// Scene Detection Types
// ========================================

/**
 * Source of scene cut detection
 */
export type SceneCutSource =
  | 'transnet_v2'      // TransNet V2 deep learning detection
  | 'ffmpeg_standard'  // FFmpeg standard detection
  | 'ffmpeg_enhanced'  // FFmpeg enhanced detection
  | 'full_frame'       // Full-frame detection (for ROI compatibility)
  | 'roi_bottom'       // ROI detection (bottom region)
  | 'roi_center'       // ROI detection (center region)
  | 'roi_top_left'     // ROI detection (top-left region)
  | 'roi_top_right'    // ROI detection (top-right region)
  | 'both'             // Detected by both methods
  | 'supplementary';   // Supplementary detection (luminance, black, etc.)

/**
 * Scene cut detected during video analysis
 */
export interface SceneCut {
  /** Timestamp in seconds */
  timestamp: number;
  /** Confidence score (0-1) */
  confidence: number;
  /** Detection source */
  source?: SceneCutSource;
  /** Frame number (if available) */
  frame?: number;
  /** Detection reason/description */
  detectionReason?: string;
}

// ========================================
// Excel Generation Types
// ========================================

export interface SceneData {
  sceneNumber: number;
  startTime: number;
  endTime: number;
  midTime: number;
  framePath: string;
  ocrText: string;
  narration: string;
}

export interface PipelineStats {
  totalScenes: number;
  scenesWithOCRText: number;
  scenesWithNarration: number;
}

export interface PipelineResult {
  excelPath: string;
  stats: PipelineStats;
}

// ========================================
// API Request/Response Types
// ========================================

export interface ProcessVideoRequest {
  uploadId: string;
  r2Key: string;
  fileName: string;
  dataConsent: boolean;
  detectionMode?: DetectionMode;
}

export interface ProcessVideoResponse {
  success: boolean;
  uploadId: string;
  message: string;
  status: ProcessingStatusType;
}

export interface StatusResponse {
  uploadId: string;
  status: ProcessingStatusType;
  progress: number;
  stage?: ProcessingStage;
  startedAt: string;
  updatedAt: string;
  resultUrl?: string;
  metadata?: ProcessingMetadata;
  error?: string;
}

// ========================================
// Error Context Types
// ========================================

export interface ErrorContext {
  uploadId?: string;
  r2Key?: string;
  blobUrl?: string; // @deprecated - Use r2Key instead
  operation?: string;
  stage?: string;
  [key: string]: unknown;
}
