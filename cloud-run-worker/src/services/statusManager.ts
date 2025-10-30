import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

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
  };
  error?: string;
}

/**
 * Initialize processing status in Supabase
 */
export const initStatus = async (uploadId: string): Promise<ProcessingStatus> => {
  const now = new Date().toISOString();
  const status: ProcessingStatus = {
    uploadId,
    status: 'pending',
    progress: 0,
    stage: 'downloading',
    startedAt: now,
    updatedAt: now,
  };

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
    console.error(`[${uploadId}] Failed to init status:`, error);
    throw error;
  }

  return status;
};

/**
 * Update processing status in Supabase
 */
export const updateStatus = async (
  uploadId: string,
  updates: Partial<ProcessingStatus>
): Promise<ProcessingStatus> => {
  const updatePayload: any = {
    updated_at: new Date().toISOString(),
  };

  // Map camelCase to snake_case for Supabase
  if (updates.status) updatePayload.status = updates.status;
  if (updates.progress !== undefined) updatePayload.progress = updates.progress;
  if (updates.stage) updatePayload.stage = updates.stage;
  if (updates.resultUrl) updatePayload.result_url = updates.resultUrl;
  if (updates.error) updatePayload.error = updates.error;
  if (updates.metadata) updatePayload.metadata = updates.metadata;

  const { data, error } = await supabase
    .from('processing_status')
    .update(updatePayload)
    .eq('upload_id', uploadId)
    .select()
    .single();

  if (error) {
    console.error(`[${uploadId}] Failed to update status:`, error);
    throw error;
  }

  return mapDbRowToStatus(data);
};

/**
 * Get processing status from Supabase
 */
export const getStatus = async (uploadId: string): Promise<ProcessingStatus | null> => {
  const { data, error } = await supabase
    .from('processing_status')
    .select()
    .eq('upload_id', uploadId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      // Not found
      return null;
    }
    console.error(`[${uploadId}] Failed to get status:`, error);
    throw error;
  }

  return mapDbRowToStatus(data);
};

/**
 * Mark processing as complete
 */
export const completeStatus = async (
  uploadId: string,
  resultUrl: string,
  metadata: ProcessingStatus['metadata']
): Promise<ProcessingStatus> => {
  return updateStatus(uploadId, {
    status: 'completed',
    progress: 100,
    stage: 'completed',
    resultUrl,
    metadata,
  });
};

/**
 * Mark processing as failed
 */
export const failStatus = async (uploadId: string, error: string): Promise<ProcessingStatus> => {
  return updateStatus(uploadId, {
    status: 'error',
    progress: 0,
    error,
  });
};

/**
 * Map database row to ProcessingStatus type
 */
function mapDbRowToStatus(row: any): ProcessingStatus {
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
