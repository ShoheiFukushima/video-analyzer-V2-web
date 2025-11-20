# セッション引き継ぎ - 2025年11月6日

## 📋 作業サマリー

**作業期間**: 2025-11-06 15:30 - 16:00 (JST)
**対応者**: Claude Code
**メインタスク**: 動画処理が10%で停止する問題の修正

---

## 🔴 解決した問題

### 問題1: 動画ダウンロードタイムアウト（60秒）
**症状**:
- 大きな動画ファイル（445MB）のダウンロードが60秒でタイムアウト
- 処理が10%（"downloading"ステージ）で停止
- Cloud Runログに「Downloading video from blob...」と表示後、無反応

**修正内容**:
```typescript
// Before
timeout: 60000  // 60秒

// After
timeout: 300000,  // 5分（300秒）
maxContentLength: 500 * 1024 * 1024,  // 500MB制限
maxBodyLength: 500 * 1024 * 1024
```

**影響ファイル**: `cloud-run-worker/src/services/videoProcessor.ts:187-191`
**コミット**: `7d893d1`
**デプロイ**: Cloud Run リビジョン `00012-5c5`

---

### 問題2: 進捗ログが出力されない
**症状**:
- ダウンロード進捗ログが一度も出力されない
- Cloud Runログで処理状況が追跡できない

**根本原因**:
```typescript
// Before: 10MBの倍数ちょうどの時だけログ（ほぼ発火しない）
if (totalBytes > 0 && downloadedBytes % (10 * 1024 * 1024) === 0) {
  console.log(`Progress: ...`);
}
```

この条件では、chunkサイズが可変のため、10MBの倍数ちょうどになることはほとんどない。

**修正内容**:
```typescript
// After: 最後のログから10MB以上ダウンロードされたらログ出力
let lastLoggedBytes = 0;
if (totalBytes > 0 && downloadedBytes - lastLoggedBytes >= LOG_INTERVAL) {
  console.log(`Progress: ${percent}% (${downloadedMB}MB / ${totalMB}MB)`);
  lastLoggedBytes = downloadedBytes;
}
```

**影響ファイル**: `cloud-run-worker/src/services/videoProcessor.ts:207-219`
**コミット**: `95dda0f`
**デプロイ**: Cloud Run リビジョン `00013-vw9` ✅ **現在アクティブ**

---

## 📦 現在のデプロイ状況

### Cloud Run Worker
- **Service**: `video-analyzer-worker`
- **Region**: `us-central1`
- **Active Revision**: `video-analyzer-worker-00013-vw9`
- **URL**: `https://video-analyzer-worker-820467345033.us-central1.run.app`
- **Status**: ✅ 100%トラフィック配信中

### Vercel Frontend
- **Project**: `video-analyzer-v2-web`
- **URL**: `https://video-analyzer-v2-web.vercel.app`
- **Status**: ✅ デプロイ済み（Phase 2 IDOR修正適用済み）

### Supabase
- **Migration**: `002_add_user_id_and_fix_rls.sql` ✅ 実行済み
- **RLS Policy**: ユーザーごとのアクセス制御有効

---

## ⚠️ 未解決の問題

### 現在進行中のアップロードが古いリビジョンで動作中
**Upload ID**: `upload_1762443623001_vv5bljsh0`
- デプロイ前（リビジョン 00012）のインスタンスで処理中
- 15:45:45 開始、15:46:04にレスポンス受信後、無反応（15分以上経過）
- **ステータス**: "downloading" 10%で停止
- **原因**: 旧リビジョンの60秒タイムアウト制限

**対処法**:
- ユーザーに新しい動画を再アップロードしてもらう
- 新規アップロードは新しいリビジョン（00013）で処理される

---

## 🔍 次にエラーが出た場合のチェックリスト

### ケース1: 処理が10%で停止（ダウンロード段階）

#### ステップ1: Supabaseでステータス確認
```bash
cd /Users/fukushimashouhei/dev1/projects/video-analyzer-V2-web

node -e "
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

(async () => {
  const { data, error } = await supabase
    .from('processing_status')
    .select('*')
    .eq('upload_id', 'UPLOAD_ID_HERE')  // ← Upload IDを入れる
    .single();

  console.log(JSON.stringify(data, null, 2));
})();
"
```

**チェック項目**:
- `status`: "downloading" で止まっているか？
- `updated_at`: 最終更新から何分経過しているか？（5分以上なら異常）
- `user_id`: 正しく設定されているか？

---

#### ステップ2: Cloud Runログを確認
```bash
# 最新のログを確認
gcloud run services logs read video-analyzer-worker \
  --region us-central1 \
  --limit 100 \
  --format "value(timestamp,log)" \
  | grep "UPLOAD_ID_HERE"
```

**期待される正常なログ**:
```
[upload_xxx] Starting video processing for user user_xxx
[upload_xxx] Downloading video from blob...
[downloadFile] Starting download from: https://...
[downloadFile] Response received, content-length: 466536577
[downloadFile] Progress: 2.2% (10.0MB / 445.0MB)  ← これが出力されるべき！
[downloadFile] Progress: 4.5% (20.0MB / 445.0MB)
[downloadFile] Progress: 6.7% (30.0MB / 445.0MB)
...
[downloadFile] Download complete: 445.0MB
[upload_xxx] Deleting source video blob...
```

**異常パターンと対処**:

| ログの状態 | 原因 | 対処法 |
|-----------|------|--------|
| "Response received" の後、進捗ログなし | 旧リビジョンで動作中 | 新規アップロード要求 |
| "Starting download" すら出ない | Worker起動失敗 | Cloud Run起動ログ確認 |
| "Axios request failed" エラー | Blob URLアクセス失敗 | Blob URLの有効期限確認 |
| "timeout" エラー | 5分でもタイムアウト | ファイルサイズ確認（500MB超？） |

---

#### ステップ3: 現在のリビジョンを確認
```bash
gcloud run services describe video-analyzer-worker \
  --region us-central1 \
  --format "value(status.latestReadyRevisionName)"
```

**期待される結果**: `video-analyzer-worker-00013-vw9` 以降

もし古いリビジョンが表示される場合:
```bash
# 最新コードを再デプロイ
cd cloud-run-worker
gcloud run deploy video-analyzer-worker --source . --region us-central1
```

---

#### ステップ4: Vercel Blobの有効性確認
```bash
# Blob URL検証（コンソールエラーから取得）
curl -I "BLOB_URL_HERE"
```

**期待される結果**: `HTTP/2 200` または `HTTP/2 302`

**エラーパターン**:
- `404 Not Found`: Blobが削除された（処理完了後に自動削除される）
- `403 Forbidden`: アクセストークン期限切れ（要調査）

---

### ケース2: 404エラー（/api/status エンドポイト）

#### 原因1: Upload IDの不一致
**確認方法**:
1. ブラウザ開発者コンソールでネットワークタブ確認
2. `/api/status/upload_xxx` のURLをコピー
3. Supabaseで直接検索:

```bash
node -e "
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

(async () => {
  // 部分一致検索
  const { data } = await supabase
    .from('processing_status')
    .select('upload_id, status, progress')
    .ilike('upload_id', '%PARTIAL_ID%')  // 一部を入れる
    .order('started_at', { ascending: false })
    .limit(5);

  console.log(data);
})();
"
```

#### 原因2: RLSポリシーでブロック
**確認方法**:
```bash
# Service Roleキーで直接確認（RLSバイパス）
node -e "
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

(async () => {
  const { data } = await supabase
    .from('processing_status')
    .select('upload_id, user_id, status')
    .order('started_at', { ascending: false })
    .limit(5);

  console.log('最新5件:', data);
})();
"
```

**対処法**:
- データが見つかる場合 → RLSポリシーでブロックされている
- `user_id`が正しいか確認
- Clerkの認証トークンが期限切れでないか確認

---

### ケース3: 処理が他のステージで停止

#### 20% - メタデータ抽出
```bash
# ffmpegログ確認
gcloud run services logs read video-analyzer-worker \
  --region us-central1 \
  --limit 100 | grep -E "(ffmpeg|metadata|getVideoMetadata)"
```

**可能性**:
- 動画ファイルが破損
- ffmpegエラー

---

#### 30-45% - 音声抽出/Whisper処理
```bash
# VAD/Whisperログ確認
gcloud run services logs read video-analyzer-worker \
  --region us-central1 \
  --limit 100 | grep -E "(Whisper|VAD|audio)"
```

**可能性**:
- 音声ストリームが存在しない（正常スキップ）
- Whisper APIタイムアウト
- VAD処理失敗

---

#### 60-90% - シーン検出/OCR/Excel生成
```bash
# Pipeline処理ログ確認
gcloud run services logs read video-analyzer-worker \
  --region us-central1 \
  --limit 100 | grep -E "(pipeline|scene|OCR|Excel)"
```

**可能性**:
- Gemini Vision APIタイムアウト
- メモリ不足（大量のフレーム処理）
- Excel生成エラー

---

## 🧪 テスト手順

### 新規アップロードでテスト
1. ブラウザで https://video-analyzer-v2-web.vercel.app を開く
2. 同じ動画（MOTOYAMA_V2_1101.mp4）を再アップロード
3. 開発者コンソールを開いてネットワークタブ確認
4. Upload IDをメモ（例: `upload_1762445000000_xxxxx`）

### ログ監視（リアルタイム）
```bash
# Cloud Runログをストリーミング監視
gcloud run services logs tail video-analyzer-worker \
  --region us-central1
```

### 期待される動作
1. **0-10秒**: 処理開始、Supabaseステータス初期化
2. **10-180秒**: ダウンロード進行中
   - 10MBごとに進捗ログ出力
   - `[downloadFile] Progress: 2.2% (10.0MB / 445.0MB)`
3. **180-300秒**: メタデータ抽出、音声処理、OCR処理
4. **300-360秒**: Excel生成、アップロード
5. **完了**: "Processing Completed!" 表示、自動ダウンロード開始

---

## 📝 重要なファイル

### Cloud Run Worker
- **`cloud-run-worker/src/services/videoProcessor.ts`**: メイン処理ロジック
  - `downloadFile()` 関数（184-239行目）← 今回修正箇所
  - `processVideo()` 関数（28-182行目）
- **`cloud-run-worker/src/services/statusManager.ts`**: Supabaseステータス管理
- **`cloud-run-worker/src/index.ts`**: Worker エントリーポイント

### Next.js Frontend
- **`app/api/status/[uploadId]/route.ts`**: ステータス取得API
- **`app/api/download/[uploadId]/route.ts`**: ダウンロードAPI
- **`app/components/ProcessingStatus.tsx`**: 進捗UI

---

## 🔐 環境変数（確認用）

### Cloud Run Worker（GCP Secret Manager）
```bash
gcloud secrets versions access latest --secret="SUPABASE_URL"
gcloud secrets versions access latest --secret="SUPABASE_SERVICE_ROLE_KEY"
gcloud secrets versions access latest --secret="GEMINI_API_KEY"
gcloud secrets versions access latest --secret="OPENAI_API_KEY"
gcloud secrets versions access latest --secret="VERCEL_BLOB_READ_WRITE_TOKEN"
gcloud secrets versions access latest --secret="WORKER_SECRET"
```

### Vercel Frontend
```bash
# .env.local で確認
cat .env.local | grep -E "^(NEXT_PUBLIC_|SUPABASE_|CLERK_|BLOB_|WORKER_)"
```

---

## 🚀 次のステップ

### 即座に実施（必須）
1. ✅ **新規動画アップロードでテスト**
   - リビジョン 00013 で正常動作することを確認
   - 進捗ログが10MBごとに出力されることを確認
2. ⏳ **古いアップロードをクリーンアップ**
   - `upload_1762443623001_vv5bljsh0` をSupabaseから削除（任意）

### Phase 1 セキュリティタスク（保留中）
1. ⏳ Git履歴から機密情報を削除
2. ⏳ 全APIキーをローテーション
   - Clerk Secret Key
   - Vercel Blob Token
   - Supabase Service Role Key
   - WORKER_SECRET

### 監視とメトリクス
1. ⏳ Cloud Monitoring アラート設定
   - ダウンロードタイムアウト検知（5分以上）
   - メモリ使用率 > 85%
   - エラーレート > 5%
2. ⏳ Supabase ステータステーブル定期クリーンアップ
   - 完了から7日以上経過したレコード削除

---

## 📞 トラブルシューティング連絡先

### GCP Cloud Run
- プロジェクトID: `video-analyzer-worker`
- リージョン: `us-central1`
- [Cloud Run Console](https://console.cloud.google.com/run?project=video-analyzer-worker)

### Supabase
- プロジェクトID: `gcwdkjyyhmqtrxvmvnvn`
- [Supabase Dashboard](https://supabase.com/dashboard/project/gcwdkjyyhmqtrxvmvnvn)

### Vercel
- プロジェクト: `video-analyzer-v2-web`
- [Vercel Dashboard](https://vercel.com/dashboard)

---

## ✅ セッション完了チェックリスト

- [x] ダウンロードタイムアウトを60秒→300秒に増加
- [x] 進捗ログロジックを修正（10MB倍数 → 累積10MB）
- [x] Cloud Runにデプロイ（リビジョン 00013）
- [x] 問題の原因と修正内容をドキュメント化
- [x] 次回エラー時のチェックリストを作成
- [ ] 新規アップロードでテスト実施（ユーザー待ち）

---

**作成日時**: 2025-11-06 16:00 JST
**次回セッション**: 新規アップロードのテスト結果を確認後、Phase 1セキュリティタスクに着手
