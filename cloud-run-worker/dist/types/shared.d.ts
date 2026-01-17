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
export type ProcessingStage = 'downloading' | 'compressing' | 'metadata' | 'audio' | 'audio_skipped' | 'vad_whisper' | 'luminance_detection' | 'text_stabilization' | 'scene_ocr_excel' | 'multi_frame_ocr' | 'ocr_processing' | 'ocr_completed' | 'upload_result' | 'completed';
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