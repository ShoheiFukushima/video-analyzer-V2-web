# 本番環境 手動テストチェックリスト

**実施環境**: Cloud Run + Vercel (本番環境)
**最終更新**: 2025-11-02

---

## 事前準備

### 環境変数の確認
```bash
# Cloud Run URL
echo $CLOUD_RUN_URL
# 期待値: https://video-analyzer-worker-820467345033.us-central1.run.app

# Worker Secret
echo $WORKER_SECRET
# 期待値: 4MeGFIt36xoh1GdGLu9jnYLVX90BuzJqGrytHGjeNMw=
```

### テスト用ファイルの準備
- [ ] 短い動画ファイル (5-10秒、MP4形式) を用意
- [ ] ファイルサイズ: 10MB以下推奨
- [ ] テスト用のClerkアカウントでログイン可能を確認

---

## Phase 1: Cloud Run Worker単体テスト

### Test 1.1: ヘルスチェック ✅
```bash
curl -s https://video-analyzer-worker-820467345033.us-central1.run.app/health | jq
```

**期待結果**:
```json
{
  "status": "ok",
  "timestamp": "2025-11-02T..."
}
```

**確認項目**:
- [ ] HTTPステータスコード: 200
- [ ] statusフィールドが "ok"
- [ ] timestampが現在時刻
- [ ] レスポンスタイム < 2秒

---

### Test 1.2: 認証なしアクセスの拒否 ✅
```bash
# Statusエンドポイント（認証なし）
curl -s -w "\nHTTP: %{http_code}\n" \
  https://video-analyzer-worker-820467345033.us-central1.run.app/status/test123
```

**期待結果**:
```json
{"error":"Unauthorized"}
```

**確認項目**:
- [ ] HTTPステータスコード: 401
- [ ] errorメッセージが "Unauthorized"

---

### Test 1.3: 認証ありステータス確認 ✅
```bash
curl -s -H "Authorization: Bearer 4MeGFIt36xoh1GdGLu9jnYLVX90BuzJqGrytHGjeNMw=" \
  https://video-analyzer-worker-820467345033.us-central1.run.app/status/non_existent_id | jq
```

**期待結果**:
```json
{"error":"Upload not found"}
```

**確認項目**:
- [ ] HTTPステータスコード: 404
- [ ] errorメッセージが適切

---

### Test 1.4: 無効なリクエストの拒否 ✅
```bash
curl -s -X POST \
  -H "Authorization: Bearer 4MeGFIt36xoh1GdGLu9jnYLVX90BuzJqGrytHGjeNMw=" \
  -H "Content-Type: application/json" \
  -d '{}' \
  https://video-analyzer-worker-820467345033.us-central1.run.app/process | jq
```

**期待結果**:
```json
{
  "error": "Invalid request",
  "message": "Missing uploadId or blobUrl"
}
```

**確認項目**:
- [ ] HTTPステータスコード: 400
- [ ] エラーメッセージが明確

---

## Phase 2: フロントエンド統合テスト

### Test 2.1: アプリケーションアクセス
1. ブラウザで `https://your-app.vercel.app` にアクセス
   - [ ] ページが正常に表示される
   - [ ] Clerkログインボタンが表示される

### Test 2.2: 認証フロー
1. "Sign In" をクリック
   - [ ] Clerkログインモーダルが表示される
2. テストアカウントでログイン
   - [ ] ログイン成功
   - [ ] ダッシュボードが表示される
   - [ ] ユーザー名が表示される

### Test 2.3: 動画アップロード
1. "Upload Video" ボタンをクリック
   - [ ] ファイル選択ダイアログが表示される
2. テスト動画を選択
   - [ ] アップロード進捗が表示される
   - [ ] 完了後、処理が自動で開始される

**ブラウザDevToolsで確認**:
```javascript
// Console
Network タブ:
  - POST /api/blob-upload → 200 OK
  - POST /api/process → 200 OK
  - GET /api/status/:uploadId → 200 OK (ポーリング)
```

### Test 2.4: ステータスポーリング
1. アップロード後、ステータス表示を観察
   - [ ] "Processing..." が表示される
   - [ ] 進捗バーが更新される（該当する場合）
   - [ ] 数秒〜数十秒後に完了

**確認項目**:
- [ ] 定期的に `/api/status/:uploadId` をポーリング
- [ ] エラー時に適切なメッセージ表示
- [ ] 処理完了時に「Download Excel」ボタン表示

### Test 2.5: 結果ダウンロード
1. "Download Excel" ボタンをクリック
   - [ ] Excelファイルがダウンロードされる
   - [ ] ファイル名: `result_[uploadId].xlsx`
2. Excelファイルを開く
   - [ ] 時系列データが正しく表示される
   - [ ] フォーマットが正しい（ヘッダー、列幅など）

---

## Phase 3: エラーハンドリングテスト

### Test 3.1: 無効なファイル形式
1. 動画以外のファイル（.txt、.pdfなど）をアップロード
   - [ ] エラーメッセージが表示される
   - [ ] "Invalid file type" などの明確なメッセージ

### Test 3.2: 大きすぎるファイル
1. 100MB以上の動画をアップロード（設定されている場合）
   - [ ] アップロード制限エラーが表示される
   - [ ] ユーザーに適切なフィードバック

### Test 3.3: ネットワークエラーシミュレーション
1. DevToolsで "Offline" モードに設定
2. 動画アップロードを試行
   - [ ] エラーメッセージが表示される
   - [ ] リトライボタンが表示される（該当する場合）

### Test 3.4: 未認証アクセス
1. ログアウト状態でダイレクトURLにアクセス
   ```
   https://your-app.vercel.app/dashboard
   ```
   - [ ] ログインページにリダイレクトされる
   - [ ] 401エラーではなく、適切なUI表示

---

## Phase 4: パフォーマンステスト

### Test 4.1: レスポンスタイム測定
```bash
# Health check
time curl -s https://video-analyzer-worker-820467345033.us-central1.run.app/health

# Status check (認証あり)
time curl -s -H "Authorization: Bearer 4MeGFIt36xoh1GdGLu9jnYLVX90BuzJqGrytHGjeNMw=" \
  https://video-analyzer-worker-820467345033.us-central1.run.app/status/test123
```

**確認項目**:
- [ ] Health check: < 500ms (ウォーム時)
- [ ] Status check: < 500ms
- [ ] Cold start: < 5秒

### Test 4.2: 並行リクエスト
```bash
# 5並列リクエスト
for i in {1..5}; do
  curl -s -H "Authorization: Bearer 4MeGFIt36xoh1GdGLu9jnYLVX90BuzJqGrytHGjeNMw=" \
    https://video-analyzer-worker-820467345033.us-central1.run.app/health &
done
wait
```

**確認項目**:
- [ ] すべてのリクエストが正常に完了
- [ ] レスポンスタイムが大幅に増加しない

---

## Phase 5: セキュリティテスト

### Test 5.1: 認証トークンの検証
```bash
# 無効なトークン
curl -s -H "Authorization: Bearer invalid_token_12345" \
  https://video-analyzer-worker-820467345033.us-central1.run.app/status/test123
```

**確認項目**:
- [ ] HTTPステータスコード: 401
- [ ] エラーメッセージに機密情報が含まれていない

### Test 5.2: SQLインジェクション対策（該当する場合）
```bash
# 悪意のあるuploadId
curl -s -H "Authorization: Bearer 4MeGFIt36xoh1GdGLu9jnYLVX90BuzJqGrytHGjeNMw=" \
  "https://video-analyzer-worker-820467345033.us-central1.run.app/status/'; DROP TABLE uploads; --"
```

**確認項目**:
- [ ] エラーメッセージが返る（500エラーではない）
- [ ] データベースが影響を受けない
- [ ] エラーログに適切に記録される

### Test 5.3: XSS対策
1. フロントエンドで悪意のあるファイル名をアップロード
   ```
   <script>alert('XSS')</script>.mp4
   ```
   - [ ] スクリプトが実行されない
   - [ ] ファイル名がエスケープされて表示される

---

## Phase 6: モニタリング確認

### Test 6.1: Cloud Runログの確認
```bash
gcloud logging read "resource.type=cloud_run_revision" \
  --project=video-analyzer-v2 \
  --limit=50 \
  --format=json
```

**確認項目**:
- [ ] リクエストログが記録されている
- [ ] エラーログが適切に記録されている
- [ ] パフォーマンスメトリクスが取得できる

### Test 6.2: Vercelログの確認
1. Vercel Dashboardにアクセス
   - [ ] デプロイログが正常
   - [ ] ランタイムエラーがない
   - [ ] パフォーマンスメトリクスが正常範囲

---

## チェックリスト完了後のアクション

### ✅ すべてのテストが成功した場合
1. **本番環境リリース準備完了**
2. ステークホルダーに報告
3. 本番環境URLをユーザーに公開

### ⚠️ 一部テストが失敗した場合
1. **失敗したテストを記録**
   ```markdown
   - Test ID: 2.3
   - 症状: アップロード進捗が表示されない
   - 再現手順: ...
   - エラーメッセージ: ...
   ```

2. **優先度の判定**
   - クリティカル: 機能が全く動作しない
   - 高: 一部機能に影響
   - 中: UX上の問題
   - 低: マイナーな表示崩れ

3. **修正 → 再テスト**

---

## トラブルシューティング

### 問題: Health checkが500エラー
```bash
# Cloud Runログを確認
gcloud logging read "resource.type=cloud_run_revision AND severity>=ERROR" \
  --limit=10

# 環境変数を確認
gcloud run services describe video-analyzer-worker \
  --region=us-central1 \
  --format="value(spec.template.spec.containers[0].env)"
```

### 問題: 認証エラー (401)
1. WORKER_SECRETが正しく設定されているか確認
2. Clerk認証トークンが有効か確認
3. Next.js環境変数（.env.local）を確認

### 問題: アップロードが失敗する
1. Vercel Blob設定を確認
   ```bash
   echo $BLOB_READ_WRITE_TOKEN
   ```
2. ファイルサイズ制限を確認
3. CORS設定を確認

### 問題: 処理が完了しない
1. Cloud Runログでエラーを確認
2. OpenAI API / Gemini APIの制限を確認
3. タイムアウト設定を確認（Cloud Run: デフォルト300秒）

---

## 関連ドキュメント

- **E2Eテストレポート**: `/Users/fukushimashouhei/dev1/projects/video-analyzer-V2-web/E2E_TEST_REPORT.md`
- **デプロイ設計**: `/Users/fukushimashouhei/dev1/projects/video-analyzer-V2-web/DEPLOYMENT_DESIGN.md`
- **APIドキュメント**: `/Users/fukushimashouhei/dev1/projects/video-analyzer-V2-web/API_DOCUMENTATION.md`

---

**最終更新**: 2025-11-02
**作成者**: Claude Code (Quality Engineer)
