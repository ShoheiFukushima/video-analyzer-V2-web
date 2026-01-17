import type { ProcessingStatus } from '../types/shared.js';
export type { ProcessingStatus };
/**
 * Initialize processing status (Dual mode: Turso or In-memory)
 * @param uploadId - Unique upload identifier
 * @param userId - Clerk user ID for IDOR protection
 */
export declare const initStatus: (uploadId: string, userId: string) => Promise<ProcessingStatus>;
/**
 * Update processing status (Dual mode: Turso or In-memory)
 */
export declare const updateStatus: (uploadId: string, updates: Partial<ProcessingStatus>) => Promise<ProcessingStatus>;
/**
 * Get processing status (Dual mode: Turso or In-memory)
 */
export declare const getStatus: (uploadId: string) => Promise<ProcessingStatus | null>;
/**
 * Mark processing as complete (Dual mode: Turso or In-memory)
 */
export declare const completeStatus: (uploadId: string, resultUrl: string, metadata: ProcessingStatus["metadata"]) => Promise<ProcessingStatus>;
/**
 * Mark processing as failed (Dual mode: Turso or In-memory)
 */
export declare const failStatus: (uploadId: string, error: string) => Promise<ProcessingStatus>;
//# sourceMappingURL=statusManager.d.ts.map