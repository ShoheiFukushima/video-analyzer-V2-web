# GitHub Actions CI/CD Workflows

このディレクトリには、Video Analyzer V2 Webプロジェクトの自動化されたCI/CDパイプラインが含まれています。

## ワークフロー概要

### 1. Test Pipeline (`test.yml`)

**トリガー**:
- Pull Request（mainブランチ向け）
- mainブランチへのプッシュ

**実行内容**:
- フロントエンド（Next.js）のビルド確認
- フロントエンドのテスト実行
- テストカバレッジレポート生成
- バックエンドワーカー（Cloud Run）のビルド確認

**ジョブ構成**:
1. `test-frontend`: フロントエンドのテスト
2. `test-worker`: バックエンドワーカーのテスト
3. `test-summary`: テスト結果のサマリー

**所要時間**: 約3-5分

---

### 2. Deploy to Production (`deploy-production.yml`)

**トリガー**:
- mainブランチへのプッシュ
- 手動トリガー（`workflow_dispatch`）

**実行内容**:
1. テスト実行（test.ymlと同等）
2. フロントエンドをVercelにデプロイ
3. バックエンドワーカーをCloud Runにデプロイ
4. デプロイ結果の通知

**ジョブ構成**:
1. `test`: テスト実行
2. `deploy-frontend`: Vercelへデプロイ
3. `deploy-worker`: Cloud Runへデプロイ
4. `notify-deployment`: デプロイ状況の通知

**所要時間**: 約10-15分

---

## セットアップ手順

### 前提条件

以下のサービスアカウント・トークンが必要です:

1. **Vercel**
   - Vercelアカウント
   - プロジェクトID
   - Organization ID
   - デプロイトークン

2. **Google Cloud Platform**
   - GCPプロジェクト
   - Cloud Run有効化
   - サービスアカウント（必要な権限付き）
   - サービスアカウントキー（JSON）

---

### 1. GitHub Secretsの設定

リポジトリの Settings > Secrets and variables > Actions > New repository secret から以下を追加:

#### Vercel関連

##### `VERCEL_TOKEN`
Vercelデプロイトークンを取得:

```bash
# Vercelアカウント設定から取得
# https://vercel.com/account/tokens

# または、CLIで生成
vercel whoami
vercel login
```

**値の例**: `vercel_1234567890abcdef`

##### `VERCEL_ORG_ID`
Organization IDを取得:

```bash
# プロジェクトディレクトリで実行
vercel link

# .vercel/project.json から取得
cat .vercel/project.json | grep orgId
```

**値の例**: `team_abc123xyz`

##### `VERCEL_PROJECT_ID`
Project IDを取得:

```bash
# .vercel/project.json から取得
cat .vercel/project.json | grep projectId
```

**値の例**: `prj_abc123xyz`

#### GCP関連

##### `GCP_SA_KEY`
サービスアカウントキーを作成:

```bash
# 1. サービスアカウント作成（未作成の場合）
gcloud iam service-accounts create github-actions-deployer \
  --description="GitHub Actions deployer for Video Analyzer Worker" \
  --display-name="GitHub Actions Deployer"

# 2. 必要な権限を付与
PROJECT_ID=$(gcloud config get-value project)
SA_EMAIL=github-actions-deployer@${PROJECT_ID}.iam.gserviceaccount.com

gcloud projects add-iam-policy-binding ${PROJECT_ID} \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/run.admin"

gcloud projects add-iam-policy-binding ${PROJECT_ID} \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/storage.admin"

gcloud projects add-iam-policy-binding ${PROJECT_ID} \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/iam.serviceAccountUser"

# 3. キーファイル生成
gcloud iam service-accounts keys create github-actions-key.json \
  --iam-account=${SA_EMAIL}

# 4. キーファイルの内容をコピー
cat github-actions-key.json

# 5. GitHub Secretsに貼り付け（JSON全体）
```

**値の例**: JSON形式のサービスアカウントキー全体

```json
{
  "type": "service_account",
  "project_id": "your-project-id",
  "private_key_id": "abc123...",
  "private_key": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n",
  "client_email": "github-actions-deployer@your-project-id.iam.gserviceaccount.com",
  "client_id": "123456789",
  "auth_uri": "https://accounts.google.com/o/oauth2/auth",
  "token_uri": "https://oauth2.googleapis.com/token",
  "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
  "client_x509_cert_url": "https://..."
}
```

##### `GCP_PROJECT_ID`
GCPプロジェクトIDを設定:

```bash
gcloud config get-value project
```

**値の例**: `video-analyzer-v2-prod`

#### オプション: Codecov（テストカバレッジ）

##### `CODECOV_TOKEN`
Codecovトークンを取得（オプション）:

```bash
# https://codecov.io/ でリポジトリを追加
# Settings > General > Repository Upload Token からトークン取得
```

**値の例**: `abc123-xyz456-def789`

---

### 2. 環境変数の設定（Cloud Run）

Cloud Runワーカーの環境変数は、手動で設定する必要があります（セキュリティ上の理由）:

```bash
gcloud run services update video-analyzer-worker \
  --region us-central1 \
  --set-env-vars \
"BLOB_READ_WRITE_TOKEN=${BLOB_READ_WRITE_TOKEN},\
SUPABASE_URL=${SUPABASE_URL},\
SUPABASE_SERVICE_ROLE_KEY=${SUPABASE_SERVICE_ROLE_KEY},\
OPENAI_API_KEY=${OPENAI_API_KEY},\
GEMINI_API_KEY=${GEMINI_API_KEY},\
WORKER_SECRET=${WORKER_SECRET},\
NODE_ENV=production"
```

**推奨**: Secret Managerへの移行（将来的な改善）

---

### 3. 動作確認

#### テストワークフローの確認

1. 新しいブランチを作成:
```bash
git checkout -b test/ci-cd-setup
```

2. 軽微な変更を加えてコミット:
```bash
echo "# CI/CD Test" >> README.md
git add README.md
git commit -m "test: CI/CD setup verification"
```

3. プルリクエストを作成:
```bash
git push origin test/ci-cd-setup
# GitHub上でPR作成
```

4. GitHub Actionsタブで`Test Pipeline`ワークフローが実行されることを確認

#### デプロイワークフローの確認

1. プルリクエストをマージ

2. GitHub Actionsタブで`Deploy to Production`ワークフローが実行されることを確認

3. デプロイ結果の確認:
```bash
# フロントエンド確認
curl https://video-analyzer-v2.vercel.app

# バックエンドワーカー確認
curl https://video-analyzer-worker-820467345033.us-central1.run.app/health
```

---

## ワークフロー詳細

### テストパイプライン（test.yml）

#### フロントエンドテスト
```yaml
- TypeScript型チェック（npm run build）
- ESLint静的解析（npm run lint）
- Jestユニットテスト（npm run test）
- カバレッジレポート生成（npm run test:coverage）
```

#### バックエンドワーカーテスト
```yaml
- TypeScriptビルド確認（npm run build）
- dist/index.js生成確認
```

### デプロイパイプライン（deploy-production.yml）

#### フロントエンドデプロイ
```yaml
- Vercel CLIによるデプロイ
- --prod フラグで本番環境に直接デプロイ
- Environment URL: https://video-analyzer-v2.vercel.app
```

#### バックエンドワーカーデプロイ
```yaml
- Google Cloud SDK認証
- Cloud Runへのデプロイ
- 設定:
  - Region: us-central1
  - Memory: 2Gi
  - CPU: 1
  - Timeout: 600秒（10分）
  - Max instances: 10
- ヘルスチェック実行
```

---

## トラブルシューティング

### 問題1: Vercelデプロイ失敗

**症状**: `Error: Invalid VERCEL_TOKEN`

**対処法**:
```bash
# 1. トークンの有効性確認
vercel whoami

# 2. 新しいトークンを生成
# https://vercel.com/account/tokens

# 3. GitHub Secretsを更新
```

### 問題2: Cloud Runデプロイ失敗

**症状**: `Error: Permission denied`

**対処法**:
```bash
# 1. サービスアカウントの権限確認
gcloud projects get-iam-policy [PROJECT_ID] \
  --flatten="bindings[].members" \
  --filter="bindings.members:github-actions-deployer"

# 2. 必要な権限を再付与
gcloud projects add-iam-policy-binding [PROJECT_ID] \
  --member="serviceAccount:[SA_EMAIL]" \
  --role="roles/run.admin"
```

### 問題3: テスト失敗

**症状**: `Tests failed in test.yml`

**対処法**:
```bash
# 1. ローカルでテスト実行
npm test
npm run build

# 2. エラーログ確認
# GitHub Actions > failed run > Logs

# 3. 依存関係の更新確認
npm ci
```

### 問題4: 環境変数未設定

**症状**: `Error: GEMINI_API_KEY not set`

**対処法**:
```bash
# Cloud Runの環境変数確認
gcloud run services describe video-analyzer-worker \
  --region us-central1 \
  --format="value(spec.template.spec.containers[0].env)"

# 環境変数を追加
gcloud run services update video-analyzer-worker \
  --region us-central1 \
  --set-env-vars "GEMINI_API_KEY=${GEMINI_API_KEY}"
```

---

## ベストプラクティス

### 1. ブランチ戦略

```
main
├─ feature/xxx → PR → Test Pipeline
├─ fix/xxx     → PR → Test Pipeline
└─ docs/xxx    → PR → Test Pipeline

main（マージ後）→ Deploy to Production
```

### 2. デプロイ承認フロー

本番デプロイ前に承認を要求する場合:

```yaml
# deploy-production.yml に追加
jobs:
  deploy-frontend:
    environment:
      name: production
      approval: required # GitHub Environment設定で有効化
```

### 3. ロールバック手順

デプロイが失敗した場合のロールバック:

```bash
# Vercel
vercel rollback

# Cloud Run
gcloud run services update video-analyzer-worker \
  --region us-central1 \
  --image [PREVIOUS_IMAGE_URL]
```

### 4. モニタリング

デプロイ後の監視:

```bash
# Vercel ログ
vercel logs --follow

# Cloud Run ログ
gcloud run services logs tail video-analyzer-worker \
  --region us-central1
```

---

## セキュリティ考慮事項

### 機密情報の管理

1. **GitHub Secretsを使用**
   - APIキー、トークンは必ずSecrets経由で参照
   - ログに機密情報を出力しない

2. **最小権限の原則**
   - サービスアカウントには必要最小限の権限のみ付与
   - 定期的に権限を見直し

3. **Secret Managerへの移行（推奨）**
   - Cloud Run環境変数からSecret Managerへ移行
   - より高度な暗号化とアクセス制御

### ワークフロー実行制限

```yaml
# ワークフロー実行を特定ブランチに制限
on:
  push:
    branches:
      - main
  pull_request:
    branches:
      - main
```

---

## FAQ

### Q1: デプロイを手動でトリガーする方法は？

**A**: GitHub Actionsタブから:
1. `Deploy to Production`ワークフローを選択
2. `Run workflow`ボタンをクリック
3. `main`ブランチを選択して実行

### Q2: テストのみ実行してデプロイをスキップする方法は？

**A**: プルリクエストを作成（マージしない）すると、`test.yml`のみが実行されます。

### Q3: デプロイログはどこで確認できる？

**A**:
- **GitHub Actions**: リポジトリ > Actions タブ
- **Vercel**: https://vercel.com/[your-org]/video-analyzer-v2/deployments
- **Cloud Run**: Cloud Console > Cloud Run > video-analyzer-worker > Logs

### Q4: CI/CDのコストは？

**A**:
- **GitHub Actions**: Public repositoryは無料、Privateは月2,000分まで無料
- **Vercel**: Hobby planは無料（帯域幅制限あり）
- **Cloud Run**: ビルド時間・実行時間に応じて課金（通常月数ドル程度）

---

## 参考リンク

- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [Vercel Deployment Documentation](https://vercel.com/docs/deployments/overview)
- [Cloud Run Deployment Documentation](https://cloud.google.com/run/docs/deploying)
- [Google Cloud SDK Authentication](https://github.com/google-github-actions/auth)

---

**最終更新**: 2025年11月7日
**バージョン**: 1.0.0
**作成者**: Claude Code (Anthropic)
