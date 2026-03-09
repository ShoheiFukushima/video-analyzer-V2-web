-- Add build_commit column to processing_checkpoints
-- This allows checkpoint invalidation when code is updated (new deployment)
-- Old checkpoints are preserved but ignored when build hash differs

ALTER TABLE processing_checkpoints ADD COLUMN build_commit TEXT;
