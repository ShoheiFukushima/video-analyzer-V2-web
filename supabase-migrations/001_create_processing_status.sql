-- ==========================================
-- Migration: 001_create_processing_status
-- Description: Create processing_status table for video analysis workflow
-- Date: 2025-10-30
-- ==========================================

-- 既存テーブル削除（冪等性確保）
DROP TABLE IF EXISTS public.processing_status CASCADE;

-- テーブル作成
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

-- コメント追加（ドキュメント化）
COMMENT ON TABLE public.processing_status IS 'Video processing workflow status tracking';
COMMENT ON COLUMN public.processing_status.upload_id IS 'Unique identifier for upload (format: upload_<timestamp>_<random>)';
COMMENT ON COLUMN public.processing_status.status IS 'Current processing state';
COMMENT ON COLUMN public.processing_status.progress IS 'Processing progress (0-100%)';
COMMENT ON COLUMN public.processing_status.stage IS 'Current processing stage description';
COMMENT ON COLUMN public.processing_status.metadata IS 'Processing metadata (duration, segmentCount, etc.)';

-- RLS有効化
ALTER TABLE public.processing_status ENABLE ROW LEVEL SECURITY;

-- service_role用ポリシー（全操作許可）
CREATE POLICY "Service role has full access to processing_status"
  ON public.processing_status
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- anon/authenticated用ポリシー（読み取りのみ）
CREATE POLICY "Authenticated users can read processing_status"
  ON public.processing_status
  FOR SELECT
  TO authenticated, anon
  USING (true);

-- インデックス作成（パフォーマンス最適化）
CREATE INDEX idx_processing_status_status ON public.processing_status(status);
CREATE INDEX idx_processing_status_updated_at ON public.processing_status(updated_at DESC);
CREATE INDEX idx_processing_status_started_at ON public.processing_status(started_at DESC);

-- 更新日時の自動更新トリガー
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_processing_status_updated_at
  BEFORE UPDATE ON public.processing_status
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- スキーマキャッシュを即座にリフレッシュ
NOTIFY pgrst, 'reload schema';

-- 確認クエリ
SELECT
  'processing_status テーブルが正常に作成されました' AS result,
  COUNT(*) AS policy_count
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'processing_status';
