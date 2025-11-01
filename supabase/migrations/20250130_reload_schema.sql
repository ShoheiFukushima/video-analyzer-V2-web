-- Force PostgREST schema cache reload
-- This migration triggers schema reload by recreating the table

-- Drop and recreate processing_status to force schema reload
DROP TABLE IF EXISTS public.processing_status CASCADE;

CREATE TABLE public.processing_status (
  upload_id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('pending', 'downloading', 'processing', 'completed', 'error')),
  progress INTEGER NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
  stage TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  result_url TEXT,
  metadata JSONB,
  error TEXT
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_processing_status_status ON public.processing_status(status);
CREATE INDEX IF NOT EXISTS idx_processing_status_updated_at ON public.processing_status(updated_at);

-- Enable Row Level Security
ALTER TABLE public.processing_status ENABLE ROW LEVEL SECURITY;

-- Create policy for service role
DROP POLICY IF EXISTS "Service role has full access to processing_status" ON public.processing_status;
CREATE POLICY "Service role has full access to processing_status"
  ON public.processing_status
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Add comment
COMMENT ON TABLE public.processing_status IS 'V2 video processing status tracking';

-- Notify PostgREST to reload schema
SELECT pg_notify('pgrst', 'reload schema');
SELECT pg_notify('pgrst', 'reload config');
