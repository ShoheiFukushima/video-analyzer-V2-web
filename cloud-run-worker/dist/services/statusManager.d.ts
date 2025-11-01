export interface ProcessingStatus {
    uploadId: string;
    status: 'pending' | 'downloading' | 'processing' | 'completed' | 'error';
    progress: number;
    stage?: string;
    startedAt: string;
    updatedAt: string;
    resultUrl?: string;
    metadata?: {
        duration: number;
        segmentCount: number;
        ocrResultCount: number;
        transcriptionLength: number;
        totalScenes?: number;
        scenesWithOCR?: number;
        scenesWithNarration?: number;
        blobUrl?: string;
    };
    error?: string;
}
/**
 * Initialize processing status (Dual mode: Supabase or In-memory)
 */
export declare const initStatus: (uploadId: string) => Promise<ProcessingStatus>;
/**
 * Update processing status (Dual mode: Supabase or In-memory)
 */
export declare const updateStatus: (uploadId: string, updates: Partial<ProcessingStatus>) => Promise<ProcessingStatus>;
/**
 * Get processing status (Dual mode: Supabase or In-memory)
 */
export declare const getStatus: (uploadId: string) => Promise<ProcessingStatus | null>;
/**
 * Mark processing as complete (Dual mode: Supabase or In-memory)
 */
export declare const completeStatus: (uploadId: string, resultUrl: string, metadata: ProcessingStatus["metadata"]) => Promise<ProcessingStatus>;
/**
 * Mark processing as failed (Dual mode: Supabase or In-memory)
 */
export declare const failStatus: (uploadId: string, error: string) => Promise<ProcessingStatus>;
//# sourceMappingURL=statusManager.d.ts.map