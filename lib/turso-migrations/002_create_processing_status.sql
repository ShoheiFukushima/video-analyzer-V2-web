-- Create processing_status table for tracking video processing jobs
-- This table stores the status of each upload for user dashboard and session recovery

CREATE TABLE IF NOT EXISTS processing_status (
  upload_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending, processing, completed, error
  progress INTEGER DEFAULT 0,              -- 0-100
  current_step TEXT,                       -- Stage name (downloading, transcription, ocr, etc.)

  -- File information
  file_name TEXT,                          -- Original filename
  file_size INTEGER,                       -- File size in bytes

  -- Result storage
  result_r2_key TEXT,                      -- R2 key for the result Excel file
  result_url TEXT,                         -- Legacy: direct URL (deprecated)

  -- Metadata (JSON for flexible data)
  metadata TEXT,                           -- JSON: phase, phaseProgress, subTask, etc.

  -- Error tracking
  error_message TEXT,

  -- Timestamps
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,                       -- When processing finished
  expires_at TEXT                          -- When result should be deleted (7 days from completion)
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_processing_status_user_id ON processing_status(user_id);
CREATE INDEX IF NOT EXISTS idx_processing_status_user_created ON processing_status(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_processing_status_status ON processing_status(status);
CREATE INDEX IF NOT EXISTS idx_processing_status_expires ON processing_status(expires_at);
