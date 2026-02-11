import dotenv from 'dotenv';
import { createClient } from '@libsql/client';
// Load environment variables
dotenv.config();
// Import shutdown flag to prevent race condition during graceful shutdown
// Note: Dynamic import to avoid circular dependency
let getShutdownFlag = () => false;
import('../index.js').then(m => {
    getShutdownFlag = () => m.isShuttingDown;
}).catch(() => {
    // Fallback for test environments
    console.log('[StatusManager] Could not import shutdown flag, using default');
});
// In-memory status storage (development mode only)
const inMemoryStatusMap = new Map();
// Turso client (lazy initialization to avoid race condition with Secret Manager)
let turso = null;
let tursoInitialized = false;
/**
 * Lazy initialization of Turso client
 * This avoids race conditions with Cloud Run Secret Manager injection
 */
function getTursoClient() {
    if (tursoInitialized) {
        return turso;
    }
    // Determine if Turso should be used
    // Use Turso in production, or when explicitly enabled
    const useTurso = process.env.NODE_ENV === 'production' || process.env.USE_TURSO === 'true';
    if (!useTurso) {
        console.log('[StatusManager] In-memory mode enabled (development)');
        tursoInitialized = true;
        return null;
    }
    // Check for required environment variables
    if (!process.env.TURSO_DATABASE_URL || !process.env.TURSO_AUTH_TOKEN) {
        console.error('[StatusManager] Missing Turso environment variables, falling back to in-memory mode');
        console.error('[StatusManager] TURSO_DATABASE_URL:', process.env.TURSO_DATABASE_URL ? 'set' : 'NOT SET');
        console.error('[StatusManager] TURSO_AUTH_TOKEN:', process.env.TURSO_AUTH_TOKEN ? 'set' : 'NOT SET');
        tursoInitialized = true;
        return null;
    }
    try {
        turso = createClient({
            url: process.env.TURSO_DATABASE_URL,
            authToken: process.env.TURSO_AUTH_TOKEN,
        });
        console.log('[StatusManager] Turso mode enabled');
        tursoInitialized = true;
        return turso;
    }
    catch (error) {
        console.error('[StatusManager] Failed to initialize Turso client:', error);
        tursoInitialized = true;
        return null;
    }
}
/**
 * Check if Turso is available
 */
function isTursoAvailable() {
    return getTursoClient() !== null;
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
    const client = getTursoClient();
    if (client) {
        // Turso mode - INSERT OR REPLACE
        await client.execute({
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
    const client = getTursoClient();
    if (client) {
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
        await client.execute({
            sql: `UPDATE processing_status SET ${setClauses.join(', ')} WHERE upload_id = ?`,
            args,
        });
        // Fetch updated record
        const result = await client.execute({
            sql: 'SELECT * FROM processing_status WHERE upload_id = ?',
            args: [uploadId],
        });
        if (result.rows.length === 0) {
            throw new Error(`[${uploadId}] Status not found in Turso`);
        }
        // Log with phase info if available
        const logInfo = {
            status: updates.status,
            progress: updates.progress,
            stage: updates.stage,
        };
        if (updates.phase)
            logInfo.phase = updates.phase;
        if (updates.phaseProgress !== undefined)
            logInfo.phaseProgress = updates.phaseProgress;
        console.log(`[${uploadId}] [Turso] Status updated:`, logInfo);
        return mapDbRowToStatus(result.rows[0], updates);
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
        // Log with phase info if available
        const logInfo = {
            status: updatedStatus.status,
            progress: updatedStatus.progress,
            stage: updatedStatus.stage,
        };
        if (updatedStatus.phase)
            logInfo.phase = updatedStatus.phase;
        if (updatedStatus.phaseProgress !== undefined)
            logInfo.phaseProgress = updatedStatus.phaseProgress;
        console.log(`[${uploadId}] [InMemory] Status updated:`, logInfo);
        return updatedStatus;
    }
};
/**
 * Update phase progress (helper function for 3-phase UI)
 * Phase data is stored in metadata JSON for persistence
 */
export const updatePhaseProgress = async (uploadId, phase, phaseProgress, options) => {
    // Skip progress updates during shutdown to prevent race condition with error status
    if (getShutdownFlag()) {
        console.log(`[${uploadId}] Skipping phase update - shutdown in progress`);
        const currentStatus = await getStatus(uploadId);
        if (currentStatus)
            return currentStatus;
        // If status not found, return a minimal status object
        const now = new Date().toISOString();
        return {
            uploadId,
            userId: '',
            status: 'processing',
            progress: 0,
            startedAt: now,
            updatedAt: now,
        };
    }
    // Calculate overall progress based on phase
    // Phase 1: 0-33%, Phase 2: 33-66%, Phase 3: 66-100%
    const phaseRanges = {
        1: [0, 33],
        2: [33, 66],
        3: [66, 100],
    };
    const [start, end] = phaseRanges[phase];
    const overallProgress = Math.round(start + (phaseProgress / 100) * (end - start));
    // Store phase data in metadata for persistence (Turso doesn't have phase columns)
    const phaseMetadata = {
        phase,
        phaseProgress,
        phaseStatus: options?.phaseStatus || 'in_progress',
        estimatedTimeRemaining: options?.estimatedTimeRemaining,
        subTask: options?.subTask,
    };
    return updateStatus(uploadId, {
        status: 'processing',
        progress: overallProgress,
        phase,
        phaseProgress,
        phaseStatus: options?.phaseStatus || 'in_progress',
        estimatedTimeRemaining: options?.estimatedTimeRemaining,
        subTask: options?.subTask,
        stage: options?.stage,
        metadata: phaseMetadata, // Store phase data in metadata
    });
};
/**
 * Mark phase as complete and move to next phase
 */
export const completePhase = async (uploadId, completedPhase) => {
    // Calculate progress at end of phase
    const phaseEndProgress = {
        1: 33,
        2: 66,
        3: 100,
    };
    return updateStatus(uploadId, {
        status: 'processing',
        progress: phaseEndProgress[completedPhase],
        phase: completedPhase,
        phaseProgress: 100,
        phaseStatus: 'completed',
    });
};
/**
 * Skip a phase (e.g., no audio detected)
 */
export const skipPhase = async (uploadId, skippedPhase, reason) => {
    return updateStatus(uploadId, {
        status: 'processing',
        phase: skippedPhase,
        phaseProgress: 100,
        phaseStatus: 'skipped',
        subTask: reason || 'Skipped',
    });
};
/**
 * Get processing status (Dual mode: Turso or In-memory)
 */
export const getStatus = async (uploadId) => {
    const client = getTursoClient();
    if (client) {
        const result = await client.execute({
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
 * @param row - Database row
 * @param updates - Optional updates with phase info (DB doesn't store phase fields yet)
 */
function mapDbRowToStatus(row, updates) {
    const status = {
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
    // Merge phase info from updates (DB doesn't have phase columns yet)
    if (updates) {
        if (updates.phase !== undefined)
            status.phase = updates.phase;
        if (updates.phaseProgress !== undefined)
            status.phaseProgress = updates.phaseProgress;
        if (updates.phaseStatus !== undefined)
            status.phaseStatus = updates.phaseStatus;
        if (updates.estimatedTimeRemaining !== undefined)
            status.estimatedTimeRemaining = updates.estimatedTimeRemaining;
        if (updates.subTask !== undefined)
            status.subTask = updates.subTask;
    }
    return status;
}
//# sourceMappingURL=statusManager.js.map