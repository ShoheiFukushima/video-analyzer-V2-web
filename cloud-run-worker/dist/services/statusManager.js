import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
// Load environment variables
dotenv.config();
// Determine if Supabase should be used
const USE_SUPABASE = process.env.USE_SUPABASE === 'true';
// In-memory status storage (development mode only)
const inMemoryStatusMap = new Map();
// Supabase client (production mode only)
let supabase = null;
// Initialize Supabase client if enabled
if (USE_SUPABASE) {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
        throw new Error('Missing required Supabase environment variables: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
    }
    supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    console.log('[StatusManager] Supabase mode enabled');
}
else {
    console.log('[StatusManager] In-memory mode enabled (development)');
}
/**
 * Enhanced error handler with detailed diagnostics
 */
function handleSupabaseError(uploadId, operation, error) {
    console.error(`[${uploadId}] Supabase ${operation} failed:`, {
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint,
    });
    // PGRST205: Schema cache issue
    if (error.code === 'PGRST205') {
        throw new Error(`Supabase schema cache error: Table 'processing_status' not found in cache. ` +
            `Please reload schema in Supabase Dashboard (Settings → API → Reload Schema) ` +
            `or run: NOTIFY pgrst, 'reload schema'; in SQL Editor`);
    }
    // PGRST116: No rows returned
    if (error.code === 'PGRST116') {
        throw new Error(`No rows returned for upload_id: ${uploadId}. ` +
            `Ensure the record exists before calling ${operation}.`);
    }
    // RLS violation
    if (error.code === '42501') {
        throw new Error(`Permission denied: Row-level security policy violation. ` +
            `Ensure service_role key is used and RLS policies are configured correctly.`);
    }
    // Generic error
    throw new Error(`Supabase ${operation} failed: ${error.message}`);
}
/**
 * Initialize processing status (Dual mode: Supabase or In-memory)
 */
export const initStatus = async (uploadId) => {
    const now = new Date().toISOString();
    const status = {
        uploadId,
        status: 'pending',
        progress: 0,
        stage: 'downloading',
        startedAt: now,
        updatedAt: now,
    };
    if (USE_SUPABASE && supabase) {
        // Supabase mode
        const { data, error } = await supabase
            .from('processing_status')
            .upsert({
            upload_id: uploadId,
            status: status.status,
            progress: status.progress,
            stage: status.stage,
            started_at: status.startedAt,
            updated_at: status.updatedAt,
        })
            .select()
            .single();
        if (error) {
            handleSupabaseError(uploadId, 'initStatus', error);
        }
        return status;
    }
    else {
        // In-memory mode
        inMemoryStatusMap.set(uploadId, status);
        console.log(`[${uploadId}] [InMemory] Status initialized`);
        return status;
    }
};
/**
 * Update processing status (Dual mode: Supabase or In-memory)
 */
export const updateStatus = async (uploadId, updates) => {
    if (USE_SUPABASE && supabase) {
        // Supabase mode
        const updatePayload = {
            updated_at: new Date().toISOString(),
        };
        // Map camelCase to snake_case for Supabase
        if (updates.status)
            updatePayload.status = updates.status;
        if (updates.progress !== undefined)
            updatePayload.progress = updates.progress;
        if (updates.stage)
            updatePayload.stage = updates.stage;
        if (updates.resultUrl)
            updatePayload.result_url = updates.resultUrl;
        if (updates.error)
            updatePayload.error = updates.error;
        if (updates.metadata)
            updatePayload.metadata = updates.metadata;
        const { data, error } = await supabase
            .from('processing_status')
            .update(updatePayload)
            .eq('upload_id', uploadId)
            .select()
            .single();
        if (error) {
            handleSupabaseError(uploadId, 'updateStatus', error);
        }
        return mapDbRowToStatus(data);
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
            updatedAt: new Date().toISOString(),
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
 * Get processing status (Dual mode: Supabase or In-memory)
 */
export const getStatus = async (uploadId) => {
    if (USE_SUPABASE && supabase) {
        // Supabase mode
        const { data, error } = await supabase
            .from('processing_status')
            .select()
            .eq('upload_id', uploadId)
            .single();
        if (error) {
            if (error.code === 'PGRST116') {
                // Not found (this is expected)
                return null;
            }
            handleSupabaseError(uploadId, 'getStatus', error);
        }
        return mapDbRowToStatus(data);
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
 * Mark processing as complete (Dual mode: Supabase or In-memory)
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
 * Mark processing as failed (Dual mode: Supabase or In-memory)
 */
export const failStatus = async (uploadId, error) => {
    return updateStatus(uploadId, {
        status: 'error',
        progress: 0,
        error,
    });
};
/**
 * Map database row to ProcessingStatus type
 */
function mapDbRowToStatus(row) {
    return {
        uploadId: row.upload_id,
        status: row.status,
        progress: row.progress,
        stage: row.stage,
        startedAt: row.started_at,
        updatedAt: row.updated_at,
        resultUrl: row.result_url,
        metadata: row.metadata,
        error: row.error,
    };
}
//# sourceMappingURL=statusManager.js.map