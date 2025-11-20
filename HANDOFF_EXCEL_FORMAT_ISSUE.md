# 🔄 引き継ぎ: Excel形式不具合調査

**作成日時**: 2025-11-04 02:40
**担当**: サブエージェント（Explore/Root Cause Analyst推奨）
**緊急度**: 高

---

## 📋 問題概要

**症状**: 本番環境で生成されるExcelファイルが古い形式になっている

- **期待する形式**: シート名「Video Analysis」「Statistics」
- **実際の形式**: シート名「Summary」「Transcription」「OCR Results」「Full Analysis」

**発生環境**:
- ❌ 本番環境（https://video-analyzer-v2.vercel.app/）
- ✅ ローカル環境（http://localhost:3001）- 正常動作

---

## ✅ 確認済み事項

### 1. ソースコードは完全に正しい

**ファイル**: `cloud-run-worker/src/services/excel-generator.ts`

```typescript
// Line 42
const worksheet = workbook.addWorksheet('Video Analysis', {
  views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }]
});

// Line 165
const statsSheet = workbook.addWorksheet('Statistics');
```

✅ コミット: `5ab4a4e` (2025-11-03 22:20)
✅ Git履歴: 10月30日から変更なし

### 2. ローカルビルドは正しい

**確認コマンド**:
```bash
cd cloud-run-worker
npm run build
grep -n "addWorksheet" dist/services/excel-generator.js
```

**結果**:
```
42:    const worksheet = workbook.addWorksheet('Video Analysis', {
165:    const statsSheet = workbook.addWorksheet('Statistics');
```

✅ ローカル dist/ (2025-11-04 02:36) は正しいコード

### 3. デプロイフロー確認済み

**実行履歴**:
```bash
# 2025-11-03 22:26 - 初回デプロイ
gcloud run deploy video-analyzer-worker \
  --source . \
  --region asia-northeast1 \
  --project video-analyzer-v2
# → Revision: video-analyzer-worker-00006-4vp

# 2025-11-04 02:19 - 再デプロイ
gcloud run deploy video-analyzer-worker \
  --source . \
  --region asia-northeast1 \
  --project video-analyzer-v2
# → Revision: video-analyzer-worker-00007-s9b
```

✅ デプロイは成功
✅ ヘルスチェック `/health` も正常

### 4. Dockerビルドプロセス確認済み

**Dockerfile** (cloud-run-worker/Dockerfile):
```dockerfile
# Line 23-26: ソースからビルド
COPY src ./src
RUN npm run build

# Line 46: 実行
CMD ["node", "dist/index.js"]
```

✅ ビルドプロセスは正しい
✅ Docker内で `npm run build` が実行される
✅ キャッシュは使用されていない（毎回新規ビルド）

### 5. フロントエンドのダウンロードフロー

**開発環境**:
- `/api/download/${uploadId}` → Cloud Run `/result/${uploadId}`

**本番環境**:
- `/api/download/${uploadId}` → Vercel Blob (Supabaseメタデータ経由)

✅ ルーティングは正しい
✅ 開発環境では正常に新形式Excelがダウンロードできる

---

## ❌ 未解決の問題

### 謎1: なぜ本番環境で古い形式が出るのか？

**可能性**:
1. **Cloud Runに古いコンテナイメージがデプロイされている**
   - Docker Build時にキャッシュが使われた？
   - 古いイメージが残っている？

2. **トラフィック分割で古いリビジョンにルーティング**
   - Revision 00006 と 00007 が混在？
   - gcloud権限がなく確認不可

3. **Vercel Blobに古いExcelファイルがキャッシュされている**
   - 新しくアップロードした動画でもテスト済み → NG
   - Blobは正しく生成されたファイルを保存しているはず

4. **Cloud Run内で別のコード生成パスが実行されている**
   - dummy-excel APIが関与？ → 呼び出し元なし（確認済み）

### 謎2: ユーザーテストファイル名の不一致

**ユーザー提供ファイル名**:
```
video-analysis-upload_1762189382318_gskyost3v.xlsx
video-analysis-upload_1762189005647_ouytf8xva.xlsx
```

**期待されるファイル名** (コードベース):
```typescript
// cloud-run-worker/src/services/excel-generator.ts:262
return `${sanitized}_${timestamp}.xlsx`;
// 例: result_upload_1762002426423_jauepkyat.xlsx
```

❓ `video-analysis-upload_*` パターンは `dummy-excel` APIのものだが、呼び出し元が見つからない

---

## 🔍 次に調査すべきこと

### 優先度: 高

1. **Cloud Run内の実際のコードを確認**
   ```bash
   # コンテナ内部に入る
   gcloud run services proxy video-analyzer-worker \
     --region asia-northeast1 \
     --project video-analyzer-v2

   # または exec で確認
   kubectl exec -it [pod-name] -- cat /app/dist/services/excel-generator.js | grep addWorksheet
   ```

2. **トラフィック分割状況を確認**
   ```bash
   gcloud run services describe video-analyzer-worker \
     --region asia-northeast1 \
     --project video-analyzer-v2 \
     --format="get(traffic)"
   ```

3. **Revision 00006 と 00007 の差分確認**
   ```bash
   gcloud run revisions describe video-analyzer-worker-00006-4vp \
     --region asia-northeast1 \
     --project video-analyzer-v2

   gcloud run revisions describe video-analyzer-worker-00007-s9b \
     --region asia-northeast1 \
     --project video-analyzer-v2
   ```

4. **実際の実行ログを確認**
   ```bash
   gcloud logging read \
     'resource.type="cloud_run_revision" AND resource.labels.service_name="video-analyzer-worker" AND textPayload:"Video Analysis"' \
     --limit 50 \
     --project video-analyzer-v2
   ```

### 優先度: 中

5. **Vercel Blob内の実ファイルを確認**
   - Supabaseから `blobUrl` を取得
   - 直接ダウンロードしてシート名確認

6. **dummy-excel APIの完全な呼び出し経路を追跡**
   - Next.js API routesの動的ルーティング確認
   - ミドルウェアやリライトルール確認

7. **Cloud Build履歴を確認**
   ```bash
   gcloud builds list --limit=10 --project video-analyzer-v2
   ```

---

## 🛠️ 推奨する解決策

### Option A: 強制クリーンビルド&デプロイ

```bash
# 1. 古いイメージを削除
gcloud container images list --repository=gcr.io/video-analyzer-v2
gcloud container images delete gcr.io/video-analyzer-v2/video-analyzer-worker:latest

# 2. キャッシュなしでビルド
cd cloud-run-worker
docker build --no-cache -t gcr.io/video-analyzer-v2/video-analyzer-worker:$(date +%s) .

# 3. プッシュ&デプロイ
docker push gcr.io/video-analyzer-v2/video-analyzer-worker:[TAG]
gcloud run deploy video-analyzer-worker \
  --image gcr.io/video-analyzer-v2/video-analyzer-worker:[TAG] \
  --region asia-northeast1 \
  --project video-analyzer-v2
```

### Option B: 全トラフィックを最新リビジョンに割り当て

```bash
gcloud run services update-traffic video-analyzer-worker \
  --to-revisions=video-analyzer-worker-00007-s9b=100 \
  --region asia-northeast1 \
  --project video-analyzer-v2
```

### Option C: GCP Consoleから手動デプロイ（権限がない場合）

1. https://console.cloud.google.com/run?project=video-analyzer-v2
2. `video-analyzer-worker` をクリック
3. 「新しいリビジョンを編集してデプロイ」
4. 「Cloud Buildで新しいイメージをビルド」を選択
5. GitHub連携、ブランチ `main`、Dockerfile `cloud-run-worker/Dockerfile`
6. デプロイ

---

## 📁 関連ファイル

### 正しいコード（確認済み）
- `cloud-run-worker/src/services/excel-generator.ts` (Line 42, 165)
- `cloud-run-worker/src/services/pipeline.ts` (Line 77)
- `cloud-run-worker/src/services/videoProcessor.ts` (Line 101-105)
- `cloud-run-worker/dist/services/excel-generator.js` (Line 42, 165)

### 疑わしいコード
- `app/api/dummy-excel/[uploadId]/route.ts` - 古い形式を生成
  - ファイル名: `video-analysis-${uploadId}.xlsx`
  - シート: Summary, Transcription, OCR Results, Full Analysis
  - **呼び出し元が見つからない**

### ダウンロードフロー
- `app/api/download/[uploadId]/route.ts` - ダウンロードAPI
- `app/components/ProcessingStatus.tsx` - フロントエンド

### デプロイ設定
- `cloud-run-worker/Dockerfile`
- `cloud-run-worker/package.json` (build script)

---

## 🔐 権限の問題

現在のアカウント `syou430@gmail.com` には以下の権限がない：
- ❌ `gcloud logging read` - Cloud Logging Viewer
- ❌ `gcloud run services describe` - Cloud Run Viewer
- ❌ `gcloud builds submit` - Cloud Build Editor

**対処法**:
1. プロジェクトオーナーに権限付与を依頼
2. GCP Consoleから手動操作
3. 別のサービスアカウントを使用

---

## 💡 仮説

最も可能性が高い原因：

1. **Cloud Runのトラフィック分割**
   - Revision 00006（古いコード）に一部トラフィックがルーティング
   - Revision 00007（新しいコード）は正しいが、到達していない

2. **Docker Build時の問題**
   - `gcloud run deploy --source .` がキャッシュを使用
   - 実際にはソースが更新されていない

3. **Vercel Blobに古いファイルがキャッシュ**
   - 新規アップロードでもテスト済みだが、何らかの理由で古いファイルが返される

---

## 🎯 次のアクション

1. **権限取得** → GCP ConsoleでCloud Runの詳細確認
2. **トラフィック分割確認** → 100%を最新リビジョンに割り当て
3. **実行ログ確認** → 実際に "Video Analysis" が生成されているか
4. **強制リビルド** → Docker no-cacheでクリーンビルド

**推奨サブエージェント**: `root-cause-analyst` または `Explore (very thorough)`

---

## 📞 連絡事項

- ユーザーは「ハードリロードして実行したけど、まだ古い」と報告
- 新しい動画をアップロードしても古い形式が出力される
- ローカル環境では完全に正常動作

**結論**: Cloud Run側の問題であることはほぼ確実。デプロイが正しく反映されていない可能性が最も高い。
