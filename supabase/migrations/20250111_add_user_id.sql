-- Add user_id column for IDOR protection (access control)
-- This migration adds user authentication support to processing_status table

-- Step 1: Add user_id column (nullable first for existing data)
ALTER TABLE public.processing_status
ADD COLUMN IF NOT EXISTS user_id TEXT;

-- Step 2: Create index for user_id queries
CREATE INDEX IF NOT EXISTS idx_processing_status_user_id
ON public.processing_status(user_id);

-- Step 3: Create composite index for the common query pattern
-- (upload_id + user_id for IDOR-protected lookups)
CREATE INDEX IF NOT EXISTS idx_processing_status_upload_user
ON public.processing_status(upload_id, user_id);

-- Step 4: Update RLS policy to include user_id based access control
-- Drop existing policy
DROP POLICY IF EXISTS "Service role has full access to processing_status" ON public.processing_status;

-- Recreate policy for service role (allows backend to manage all records)
CREATE POLICY "Service role has full access to processing_status"
  ON public.processing_status
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Add comment explaining the column
COMMENT ON COLUMN public.processing_status.user_id IS 'Clerk user ID for access control (IDOR protection)';

-- Notify PostgREST to reload schema
SELECT pg_notify('pgrst', 'reload schema');
SELECT pg_notify('pgrst', 'reload config');
