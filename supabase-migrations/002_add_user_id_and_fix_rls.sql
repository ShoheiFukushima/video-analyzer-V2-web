-- ==========================================
-- Migration: 002_add_user_id_and_fix_rls
-- Description: Add user_id column and fix IDOR vulnerability with proper RLS policies
-- Security: Prevents users from accessing other users' upload data
-- Date: 2025-11-05
-- ==========================================

-- ステップ1: user_idカラムを追加
ALTER TABLE public.processing_status
ADD COLUMN IF NOT EXISTS user_id TEXT;

-- ステップ2: user_idにインデックスを追加（パフォーマンス最適化）
CREATE INDEX IF NOT EXISTS idx_processing_status_user_id ON public.processing_status(user_id);

-- ステップ3: user_idとupload_idの複合インデックス（頻繁なクエリパターン）
CREATE INDEX IF NOT EXISTS idx_processing_status_user_upload ON public.processing_status(user_id, upload_id);

-- ステップ4: 既存の脆弱なポリシーを削除
DROP POLICY IF EXISTS "Authenticated users can read processing_status" ON public.processing_status;

-- ステップ5: 新しいセキュアなポリシーを作成
-- ポリシー1: ユーザーは自分のデータのみ読み取り可能（Clerk認証）
CREATE POLICY "Users can only read their own uploads"
  ON public.processing_status
  FOR SELECT
  TO authenticated
  USING (user_id = current_setting('request.jwt.claims', true)::json->>'sub');

-- ポリシー2: anon（未認証）ユーザーは一切アクセス不可
-- （既存のポリシーで暗黙的に拒否されるが、明示的に定義）
-- anon用のポリシーは作成しない = 完全拒否

-- ポリシー3: Service Role（Cloud Run Worker）は引き続き全アクセス可能
-- （既存のポリシーが継続適用される）

-- ステップ6: コメント追加（ドキュメント化）
COMMENT ON COLUMN public.processing_status.user_id IS 'Clerk user ID (sub claim from JWT) - ensures users can only access their own uploads';

-- ステップ7: スキーマキャッシュをリフレッシュ
NOTIFY pgrst, 'reload schema';

-- 確認クエリ
SELECT
  'user_id カラムとRLSポリシーが正常に更新されました' AS result,
  COUNT(*) AS policy_count
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'processing_status';

-- セキュリティノート
-- ================
-- このマイグレーション実行後、以下の動作になります：
-- 1. 認証済みユーザー：自分のuser_idに紐づくデータのみ読み取り可能
-- 2. 未認証ユーザー（anon）：一切のデータにアクセス不可
-- 3. Service Role（Worker）：全データにアクセス可能（管理用）
--
-- 注意事項
-- ========
-- 既存データにはuser_id=NULLとなるため、過去のアップロードは
-- ユーザーからアクセスできなくなります。必要に応じて手動で
-- user_idを設定するか、削除してください。
