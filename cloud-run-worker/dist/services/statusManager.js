import dotenv from 'dotenv';
import { createClient } from '@libsql/client';
// Load environment variables
dotenv.config();
// Determine if Turso should be used
// Use Turso in production, or when explicitly enabled
const USE_TURSO = process.env.NODE_ENV === 'production' || process.env.USE_TURSO === 'true';
// In-memory status storage (development mode only)
const inMemoryStatusMap = new Map();
// Turso client (production mode only)
let turso = null;
// Initialize Turso client if enabled
if (USE_TURSO) {
    if (!process.env.TURSO_DATABASE_URL || !process.env.TURSO_AUTH_TOKEN) {
        throw new Error('Missing required Turso environment variables: TURSO_DATABASE_URL, TURSO_AUTH_TOKEN');
    }
    turso = createClient({
        url: process.env.TURSO_DATABASE_URL,
        authToken: process.env.TURSO_AUTH_TOKEN,
    });
    console.log('[StatusManager] Turso mode enabled');
}
else {
    console.log('[StatusManager] In-memory mode enabled (development)');
}
/**
 * Initialize processing status (Dual mode: Turso or In-memory)
 * @param uploadId - Unique upload identifier
 * @param userId - Clerk user ID for IDOR protection
 */
export const initStatus = async (uploadId, userId) => {
    const now = new Date().toISOString();
    const status = {
        uploadId,
        userId,
        status: 'pending',
        progress: 0,
        stage: 'downloading',
        startedAt: now,
        updatedAt: now,
    };
    if (USE_TURSO && turso) {
        // Turso mode - INSERT OR REPLACE
        await turso.execute({
            sql: `INSERT INTO processing_status
            (upload_id, user_id, status, progress, current_step, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(upload_id) DO UPDATE SET
              user_id = excluded.user_id,
              status = excluded.status,
              progress = excluded.progress,
              current_step = excluded.current_step,
              updated_at = excluded.updated_at`,
            args: [uploadId, userId, status.status, status.progress, status.stage ?? 'downloading', now, now],
        });
        console.log(`[${uploadId}] [Turso] Status initialized for user ${userId}`);
        return status;
    }
    else {
        // In-memory mode
        inMemoryStatusMap.set(uploadId, status);
        console.log(`[${uploadId}] [InMemory] Status initialized for user ${userId}`);
        return status;
    }
};
/**
 * Update processing status (Dual mode: Turso or In-memory)
 */
export const updateStatus = async (uploadId, updates) => {
    const now = new Date().toISOString();
    if (USE_TURSO && turso) {
        // Build dynamic SET clause
        const setClauses = ['updated_at = ?'];
        const args = [now];
        if (updates.status) {
            setClauses.push('status = ?');
            args.push(updates.status);
        }
        if (updates.progress !== undefined) {
            setClauses.push('progress = ?');
            args.push(updates.progress);
        }
        if (updates.stage) {
            setClauses.push('current_step = ?'); // Map stage → current_step
            args.push(updates.stage);
        }
        if (updates.resultUrl) {
            setClauses.push('result_url = ?');
            args.push(updates.resultUrl);
        }
        if (updates.error) {
            setClauses.push('error_message = ?'); // Map error → error_message
            args.push(updates.error);
        }
        if (updates.metadata) {
            setClauses.push('metadata = ?');
            args.push(JSON.stringify(updates.metadata));
        }
        // Add upload_id for WHERE clause
        args.push(uploadId);
        await turso.execute({
            sql: `UPDATE processing_status SET ${setClauses.join(', ')} WHERE upload_id = ?`,
            args,
        });
        // Fetch updated record
        const result = await turso.execute({
            sql: 'SELECT * FROM processing_status WHERE upload_id = ?',
            args: [uploadId],
        });
        if (result.rows.length === 0) {
            throw new Error(`[${uploadId}] Status not found in Turso`);
        }
        console.log(`[${uploadId}] [Turso] Status updated:`, {
            status: updates.status,
            progress: updates.progress,
            stage: updates.stage,
        });
        return mapDbRowToStatus(result.rows[0]);
    }
    else {
        // In-memory mode
        const currentStatus = inMemoryStatusMap.get(uploadId);
        if (!currentStatus) {
            throw new Error(`[${uploadId}] Status not found in memory. Initialize first.`);
        }
        const updatedStatus = {
            ...currentStatus,
            ...updates,
            updatedAt: now,
        };
        inMemoryStatusMap.set(uploadId, updatedStatus);
        console.log(`[${uploadId}] [InMemory] Status updated:`, {
            status: updatedStatus.status,
            progress: updatedStatus.progress,
            stage: updatedStatus.stage,
        });
        return updatedStatus;
    }
};
/**
 * Get processing status (Dual mode: Turso or In-memory)
 */
export const getStatus = async (uploadId) => {
    if (USE_TURSO && turso) {
        const result = await turso.execute({
            sql: 'SELECT * FROM processing_status WHERE upload_id = ?',
            args: [uploadId],
        });
        if (result.rows.length === 0) {
            return null;
        }
        return mapDbRowToStatus(result.rows[0]);
    }
    else {
        // In-memory mode
        const status = inMemoryStatusMap.get(uploadId);
        if (status) {
            console.log(`[${uploadId}] [InMemory] Status retrieved:`, {
                status: status.status,
                progress: status.progress,
                stage: status.stage,
            });
        }
        else {
            console.log(`[${uploadId}] [InMemory] Status not found`);
        }
        return status || null;
    }
};
/**
 * Mark processing as complete (Dual mode: Turso or In-memory)
 */
export const completeStatus = async (uploadId, resultUrl, metadata) => {
    return updateStatus(uploadId, {
        status: 'completed',
        progress: 100,
        stage: 'completed',
        resultUrl,
        metadata,
    });
};
/**
 * Mark processing as failed (Dual mode: Turso or In-memory)
 */
export const failStatus = async (uploadId, error) => {
    return updateStatus(uploadId, {
        status: 'error',
        progress: 0,
        error,
    });
};
/**
 * Map Turso database row to ProcessingStatus type
 * Column mapping:
 * - current_step → stage
 * - error_message → error
 * - created_at → startedAt
 */
function mapDbRowToStatus(row) {
    return {
        uploadId: row.upload_id,
        userId: row.user_id,
        status: row.status,
        progress: row.progress,
        stage: row.current_step, // Map current_step → stage
        startedAt: row.created_at, // Map created_at → startedAt
        updatedAt: row.updated_at,
        resultUrl: row.result_url,
        metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
        error: row.error_message, // Map error_message → error
    };
}
//# sourceMappingURL=statusManager.js.map