# Supabase デプロイ前チェックリスト

## 新規テーブル作成時の必須手順

### 1. マイグレーションスクリプト実行
- [ ] `supabase-migrations/` ディレクトリのSQLファイルを実行
- [ ] Supabase SQL Editorで実行完了を確認

### 2. スキーマキャッシュリフレッシュ（必須！）
- [ ] **方法A**: Settings → API → Schema Cache → **Reload Schema** ボタンをクリック
- [ ] **方法B**: SQL Editorで `NOTIFY pgrst, 'reload schema';` を実行
- [ ] **待機**: 30秒〜1分待ってから次のステップへ

### 3. テーブル作成確認
```sql
-- テーブル存在確認
SELECT EXISTS (
  SELECT FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_name = 'your_table_name'
) AS table_exists;

-- カラム構造確認
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'your_table_name'
ORDER BY ordinal_position;
```

### 4. RLSポリシー確認
```sql
-- RLS有効状態
SELECT tablename, rowsecurity AS rls_enabled
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename = 'your_table_name';

-- ポリシー一覧
SELECT policyname, permissive, roles, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'your_table_name';
```

### 5. 接続テスト
```bash
# テストスクリプト実行
cd /path/to/worker
node /tmp/test_supabase_connection.js
```

### 6. Worker再起動
```bash
# 既存プロセス停止
pkill -f "tsx.*worker.ts"

# 再起動
cd /path/to/worker
npm run dev
```

---

## トラブルシューティング

### PGRST205エラー: "Could not find the table in the schema cache"

**原因**: PostgRESTスキーマキャッシュが更新されていない

**解決策**:
1. Supabase Dashboard → Settings → API → Reload Schema
2. SQLエディタで `NOTIFY pgrst, 'reload schema';`
3. 30秒〜1分待機
4. Worker再起動

### PGRST116エラー: "JSON object requested, multiple (or no) rows returned"

**原因**: `.single()` でクエリしたが、結果が0件または2件以上

**解決策**:
- 0件: `if (error.code === 'PGRST116') return null;` でハンドリング
- 複数件: WHERE句で絞り込み、または `.single()` を削除

### RLS違反エラー: "Row level security policy violation"

**原因**: service_roleキーではなくanon/authenticatedキーを使用

**解決策**:
- 環境変数が `SUPABASE_SERVICE_ROLE_KEY` を使用しているか確認
- service_role用RLSポリシーが存在するか確認

---

## ベストプラクティス

### 1. マイグレーションファイル命名規則
```
supabase-migrations/
  001_create_processing_status.sql
  002_add_user_metadata.sql
  003_create_analysis_results.sql
```

### 2. 冪等性の確保
```sql
-- 必ず DROP IF EXISTS を使用
DROP TABLE IF EXISTS public.my_table CASCADE;

-- CHECK制約で型安全性を確保
status TEXT NOT NULL CHECK (status IN ('pending', 'completed', 'error'))
```

### 3. スキーマキャッシュ自動リフレッシュ
```sql
-- マイグレーションファイルの最後に必ず追加
NOTIFY pgrst, 'reload schema';
```

### 4. updated_at自動更新
```sql
-- トリガーで更新日時を自動管理
CREATE TRIGGER update_my_table_updated_at
  BEFORE UPDATE ON public.my_table
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
```

### 5. インデックス設計
```sql
-- よく検索するカラムにインデックス
CREATE INDEX idx_my_table_status ON public.my_table(status);
CREATE INDEX idx_my_table_created_at ON public.my_table(created_at DESC);
```

---

## 環境変数チェック

```bash
# Worker .env ファイル
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIs... # service_roleキー

# Next.js .env.local ファイル
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIs... # anonキー
```

---

## 参考リンク

- [Supabase Schema Cache](https://supabase.com/docs/guides/api/schema-cache)
- [Row Level Security](https://supabase.com/docs/guides/auth/row-level-security)
- [Database Migrations](https://supabase.com/docs/guides/cli/local-development#database-migrations)
