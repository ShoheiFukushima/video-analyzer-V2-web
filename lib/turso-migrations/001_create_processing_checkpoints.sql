-- Create processing_checkpoints table for long video resumable processing
-- This table stores intermediate state to allow resuming interrupted processing

CREATE TABLE IF NOT EXISTS processing_checkpoints (
  upload_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  current_step TEXT NOT NULL,  -- 'downloading'|'audio_extraction'|'transcription'|'scene_detection'|'ocr'|'excel_generation'

  -- Intermediate file paths (R2 keys)
  intermediate_video_path TEXT,
  intermediate_audio_path TEXT,

  -- Video metadata
  video_duration REAL,
  total_audio_chunks INTEGER,
  total_scenes INTEGER,

  -- Progress data (stored as JSON)
  completed_audio_chunks TEXT,  -- JSON array: [0,1,2,...49]
  transcription_segments TEXT,  -- JSON array of TranscriptionSegment
  scene_cuts TEXT,              -- JSON array of SceneCut
  completed_ocr_scenes TEXT,    -- JSON array: [0,1,2,...99]
  ocr_results TEXT,             -- JSON object: {sceneIndex: ocrText}

  -- Timestamps
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,  -- 7 days from creation for auto-cleanup

  -- Retry and versioning
  retry_count INTEGER DEFAULT 0,
  version INTEGER DEFAULT 1  -- Optimistic locking
);

-- Index for cleanup queries
CREATE INDEX IF NOT EXISTS idx_checkpoints_expires_at ON processing_checkpoints(expires_at);
CREATE INDEX IF NOT EXISTS idx_checkpoints_user_id ON processing_checkpoints(user_id);
