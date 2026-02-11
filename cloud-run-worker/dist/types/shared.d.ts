/**
 * Shared Type Definitions
 *
 * Common types used across frontend and backend to ensure type consistency.
 */
/**
 * Video detection mode
 * - standard: Fast processing, detects hard cuts only
 * - enhanced: Better for fades, dissolves, text animations (slower)
 */
export type DetectionMode = 'standard' | 'enhanced';
/**
 * Detection mode descriptions for UI
 */
export declare const DETECTION_MODE_INFO: Record<DetectionMode, {
    label: string;
    description: string;
}>;
export type ProcessingStatusType = 'pending' | 'processing' | 'completed' | 'error';
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
    progress: number;
    label: string;
    estimatedTime?: string;
    subTask?: string;
}
export type ProcessingStage = 'downloading' | 'compressing' | 'metadata' | 'audio' | 'audio_skipped' | 'vad_whisper' | 'luminance_detection' | 'text_stabilization' | 'scene_ocr_excel' | 'scene_detection' | 'frame_extraction' | 'multi_frame_ocr' | 'ocr_processing' | 'ocr_completed' | 'batch_processing' | 'narration_mapping' | 'excel_generation' | 'upload_result' | 'completed';
export interface ProcessingMetadata {
    duration: number;
    segmentCount: number;
    ocrResultCount: number;
    transcriptionLength: number;
    totalScenes?: number;
    scenesWithOCR?: number;
    scenesWithNarration?: number;
    resultR2Key?: string;
    blobUrl?: string;
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
    phase?: ProcessingPhase;
    phaseProgress?: number;
    phaseStatus?: PhaseStatus;
    estimatedTimeRemaining?: string;
    subTask?: string;
}
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
    phase?: ProcessingPhase;
    phase_progress?: number;
    phase_status?: PhaseStatus;
    estimated_time_remaining?: string;
    sub_task?: string;
}
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
/**
 * Source of scene cut detection
 */
export type SceneCutSource = 'transnet_v2' | 'ffmpeg_standard' | 'ffmpeg_enhanced' | 'full_frame' | 'roi_bottom' | 'roi_center' | 'roi_top_left' | 'roi_top_right' | 'both' | 'supplementary';
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
export interface ErrorContext {
    uploadId?: string;
    r2Key?: string;
    blobUrl?: string;
    operation?: string;
    stage?: string;
    [key: string]: unknown;
}
//# sourceMappingURL=shared.d.ts.map