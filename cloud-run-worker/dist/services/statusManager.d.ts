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
    };
    error?: string;
}
/**
 * Initialize processing status in Supabase
 */
export declare const initStatus: (uploadId: string) => Promise<ProcessingStatus>;
/**
 * Update processing status in Supabase
 */
export declare const updateStatus: (uploadId: string, updates: Partial<ProcessingStatus>) => Promise<ProcessingStatus>;
/**
 * Get processing status from Supabase
 */
export declare const getStatus: (uploadId: string) => Promise<ProcessingStatus | null>;
/**
 * Mark processing as complete
 */
export declare const completeStatus: (uploadId: string, resultUrl: string, metadata: ProcessingStatus["metadata"]) => Promise<ProcessingStatus>;
/**
 * Mark processing as failed
 */
export declare const failStatus: (uploadId: string, error: string) => Promise<ProcessingStatus>;
//# sourceMappingURL=statusManager.d.ts.map