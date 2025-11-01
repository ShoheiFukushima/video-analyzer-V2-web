# Video Analyzer V2 - デプロイ設計書

## 📋 目次
1. [アーキテクチャ概要](#アーキテクチャ概要)
2. [環境構成](#環境構成)
3. [デプロイフロー](#デプロイフロー)
4. [環境変数管理](#環境変数管理)
5. [モニタリング戦略](#モニタリング戦略)
6. [スケーリング戦略](#スケーリング戦略)
7. [セキュリティ](#セキュリティ)
8. [ロールバック手順](#ロールバック手順)
9. [トラブルシューティング](#トラブルシューティング)

---

## アーキテクチャ概要

```
┌─────────────────────────────────────────────────────────────┐
│                         ユーザー                              │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Vercel (Next.js 14)                       │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  - フロントエンド (React)                            │    │
│  │  - API Routes (/api/*)                              │    │
│  │  - 認証 (Clerk)                                      │    │
│  │  - Blob Storage管理                                  │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌──────────────────┐
                    │  Vercel Blob     │
                    │  (動画・Excel)    │
                    └──────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              Google Cloud Run (Worker)                       │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  - Express.js サーバー                               │    │
│  │  - FFmpeg (シーン検出)                               │    │
│  │  - Gemini API (OCR)                                  │    │
│  │  - OpenAI Whisper (音声認識)                         │    │
│  │  - Excel生成                                          │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌──────────────────┐
                    │  Supabase        │
                    │  (ステータス管理)  │
                    └──────────────────┘
```

---

## 環境構成

### 1. 開発環境 (Development)

**フロントエンド:**
- URL: http://localhost:3001
- 環境: Node.js 24.10.0
- データベース: なし (in-memory)
- ストレージ: `/tmp` (ローカルファイル)

**バックエンド:**
- URL: http://localhost:8080
- 環境: Node.js 24.10.0
- データベース: なし (in-memory)

**環境変数:**
```bash
NODE_ENV=development
USE_SUPABASE=false
CLOUD_RUN_URL=http://localhost:8080
```

### 2. 本番環境 (Production)

**フロントエンド:**
- プラットフォーム: Vercel
- URL: https://video-analyzer-v2.vercel.app (推定)
- リージョン: Auto (CDN)
- Node.js: 20.x (Vercel推奨)

**バックエンド:**
- プラットフォーム: Google Cloud Run
- URL: https://video-analyzer-worker-820467345033.us-central1.run.app
- リージョン: us-central1
- スペック:
  - CPU: 1 vCPU
  - メモリ: 2 GiB
  - タイムアウト: 600秒
  - 最大インスタンス: 10

**環境変数:**
```bash
NODE_ENV=production
USE_SUPABASE=true
```

---

## デプロイフロー

### フロントエンド (Vercel)

```mermaid
graph LR
    A[git push main] --> B[Vercel検知]
    B --> C[ビルド開始]
    C --> D[next build]
    D --> E{成功?}
    E -->|Yes| F[プレビュー環境]
    E -->|No| G[通知 & 停止]
    F --> H[自動デプロイ]
    H --> I[本番環境]
```

**手順:**
1. `git push origin main`
2. Vercelが自動検知してビルド開始
3. ビルド成功後、本番環境に自動デプロイ
4. デプロイ完了通知 (GitHub / Slack)

**デプロイコマンド (手動):**
```bash
# Vercel CLIでデプロイ
vercel --prod
```

### バックエンド (Cloud Run)

```mermaid
graph LR
    A[git push main] --> B[ローカルでビルド確認]
    B --> C[gcloud run deploy]
    C --> D[Dockerビルド]
    D --> E[Container Registry]
    E --> F{ヘルスチェック}
    F -->|OK| G[トラフィック切替]
    F -->|NG| H[ロールバック]
```

**手順:**
1. ローカルでビルド確認: `npm run build`
2. Cloud Runにデプロイ:

```bash
cd cloud-run-worker

gcloud run deploy video-analyzer-worker \
  --source . \
  --region us-central1 \
  --platform managed \
  --allow-unauthenticated \
  --memory 2Gi \
  --cpu 1 \
  --timeout 600 \
  --max-instances 10 \
  --set-env-vars \
"BLOB_READ_WRITE_TOKEN=${BLOB_READ_WRITE_TOKEN},\
SUPABASE_URL=${SUPABASE_URL},\
SUPABASE_SERVICE_ROLE_KEY=${SUPABASE_SERVICE_ROLE_KEY},\
OPENAI_API_KEY=${OPENAI_API_KEY},\
GEMINI_API_KEY=${GEMINI_API_KEY},\
WORKER_SECRET=${WORKER_SECRET},\
NODE_ENV=production"
```

**デプロイ前チェックリスト:**
- [ ] ローカルテスト成功
- [ ] `npm run build` 成功
- [ ] 環境変数が最新
- [ ] Dockerfileが正しい
- [ ] `.dockerignore` が設定済み

---

## 環境変数管理

### フロントエンド (Vercel)

**必須変数:**
```bash
# Clerk認証
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...

# Vercel Blob
BLOB_READ_WRITE_TOKEN=vercel_blob_rw_...

# Cloud Run Worker
CLOUD_RUN_URL=https://video-analyzer-worker-820467345033.us-central1.run.app
WORKER_SECRET=4MeGFIt36xoh1GdGLu9jnYLVX90BuzJqGrytHGjeNMw=

# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://gcwdkjyyhmqtrxvmvnvn.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGci...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGci...

# モード
NODE_ENV=production
```

**設定方法:**
1. Vercel Dashboard → Project → Settings → Environment Variables
2. 本番環境に各変数を設定
3. Redeploy

### バックエンド (Cloud Run)

**必須変数:**
```bash
# Vercel Blob
BLOB_READ_WRITE_TOKEN=vercel_blob_rw_...

# Supabase
SUPABASE_URL=https://gcwdkjyyhmqtrxvmvnvn.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGci...

# AI API
OPENAI_API_KEY=sk-svcacct-...
GEMINI_API_KEY=<GEMINI_API_KEY>

# 認証
WORKER_SECRET=4MeGFIt36xoh1GdGLu9jnYLVX90BuzJqGrytHGjeNMw=

# モード
NODE_ENV=production
```

**設定方法:**
```bash
gcloud run services update video-analyzer-worker \
  --region us-central1 \
  --update-env-vars "VARIABLE=value"
```

**セキュリティ:**
- Secret Managerの使用を推奨:
```bash
# Secret Managerに保存
gcloud secrets create openai-api-key \
  --data-file=- <<< "${OPENAI_API_KEY}"

# Cloud Runから参照
gcloud run services update video-analyzer-worker \
  --update-secrets OPENAI_API_KEY=openai-api-key:latest
```

---

## モニタリング戦略

### フロントエンド (Vercel)

**メトリクス:**
- デプロイ成功率
- ビルド時間
- エッジ関数エラー率
- レスポンスタイム

**ツール:**
- Vercel Analytics (標準)
- Vercel Logs
- Sentry (エラートラッキング - オプション)

**アラート設定:**
```javascript
// vercel.json
{
  "functions": {
    "api/**/*.ts": {
      "maxDuration": 60
    }
  }
}
```

### バックエンド (Cloud Run)

**メトリクス:**
- リクエスト数
- エラー率
- レイテンシー (p50, p95, p99)
- CPU/メモリ使用率
- インスタンス数

**ツール:**
- Cloud Monitoring (標準)
- Cloud Logging
- Cloud Trace (オプション)

**ログ確認:**
```bash
# リアルタイムログ
gcloud run services logs tail video-analyzer-worker \
  --region us-central1

# エラーログのみ
gcloud run services logs read video-analyzer-worker \
  --region us-central1 \
  --filter "severity>=ERROR" \
  --limit 50
```

**アラート設定:**
```yaml
# Cloud Monitoring アラートポリシー
displayName: "Cloud Run Error Rate High"
conditions:
  - displayName: "Error rate > 5%"
    conditionThreshold:
      filter: 'resource.type="cloud_run_revision" AND metric.type="run.googleapis.com/request_count"'
      comparison: COMPARISON_GT
      thresholdValue: 0.05
      duration: 300s
```

---

## スケーリング戦略

### フロントエンド (Vercel)

**自動スケーリング:**
- Vercelが自動でスケール
- CDNキャッシュ活用
- エッジ関数の地理的分散

**最適化:**
- Next.js Image最適化
- 静的サイト生成 (SSG)
- ISR (Incremental Static Regeneration)

### バックエンド (Cloud Run)

**スケーリング設定:**
```bash
gcloud run services update video-analyzer-worker \
  --region us-central1 \
  --min-instances 0 \      # コールドスタート許容
  --max-instances 10 \     # 最大10インスタンス
  --concurrency 80         # 1インスタンスあたり80リクエスト
```

**コスト最適化:**
- `min-instances=0`: アイドル時は課金なし
- `max-instances=10`: 過剰なスケールを防止
- タイムアウト600秒: 長時間処理に対応

**パフォーマンス最適化:**
- CPU: 1 vCPU (動画処理に必要)
- メモリ: 2 GiB (FFmpeg + AI処理)
- 同時実行: 80 (I/Oバウンド処理)

---

## セキュリティ

### 認証・認可

**フロントエンド:**
- Clerk認証 (ユーザー管理)
- セッションベース認証
- CSRF保護

**バックエンド:**
- WORKER_SECRET認証 (API間通信)
- Bearer token検証
- リクエスト発信元検証

**実装:**
```typescript
// cloud-run-worker/src/index.ts
const validateAuth = (req: Request, res: Response, next: Function): void => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.replace('Bearer ', '');

  if (!token || token !== workerSecret) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  next();
};
```

### データ保護

**Blob Storage:**
- 自動クリーンアップ (処理完了後即削除)
- アクセストークン管理
- 有効期限付きURL

**データベース:**
- Supabase RLS (Row Level Security)
- サービスロールキーの制限
- 最小権限原則

### ネットワーク

**Cloud Run:**
- HTTPS強制
- `--allow-unauthenticated` (内部認証で保護)
- VPC Connector (オプション)

**Vercel:**
- 自動HTTPS
- DDoS保護
- ファイアウォール (Enterprise)

---

## ロールバック手順

### フロントエンド (Vercel)

**手順:**
1. Vercel Dashboard → Deployments
2. 安定バージョンを選択
3. "Promote to Production" をクリック

**CLI:**
```bash
# デプロイ履歴確認
vercel ls

# 特定デプロイにロールバック
vercel rollback <deployment-url>
```

### バックエンド (Cloud Run)

**手順:**
```bash
# リビジョン一覧
gcloud run revisions list \
  --service video-analyzer-worker \
  --region us-central1

# トラフィックを前のリビジョンに戻す
gcloud run services update-traffic video-analyzer-worker \
  --region us-central1 \
  --to-revisions video-analyzer-worker-00001=100
```

**緊急ロールバック:**
```bash
# 前のリビジョンに即座に切り替え
gcloud run services update-traffic video-analyzer-worker \
  --region us-central1 \
  --to-revisions LATEST=0,video-analyzer-worker-00001=100
```

---

## トラブルシューティング

### よくある問題

#### 1. Cloud Run デプロイ失敗

**症状:**
```
ERROR: Revision 'video-analyzer-worker-00003-vzh' is not ready
```

**原因:**
- ヘルスチェック失敗
- ポート8080でリッスンしていない
- 環境変数不足

**解決策:**
```bash
# ログ確認
gcloud run services logs tail video-analyzer-worker --region us-central1

# ローカルでDockerビルド確認
docker build -t test-worker -f cloud-run-worker/Dockerfile cloud-run-worker
docker run -p 8080:8080 -e NODE_ENV=production test-worker

# ヘルスチェック確認
curl http://localhost:8080/health
```

#### 2. Vercel Blob容量オーバー

**症状:**
```
Vercel Blob: Storage quota exceeded for Hobby plan (1GB maximum)
```

**解決策:**
```bash
# 手動クリーンアップ
npx dotenv -e .env.local tsx scripts/cleanup-blob-storage.ts delete-all

# 自動クリーンアップ確認
# → videoProcessor.ts と download API で自動削除されているか確認
```

#### 3. 環境変数が反映されない

**Vercel:**
```bash
# 環境変数確認
vercel env ls

# 環境変数追加
vercel env add VARIABLE_NAME

# 再デプロイ
vercel --prod
```

**Cloud Run:**
```bash
# 環境変数確認
gcloud run services describe video-analyzer-worker \
  --region us-central1 \
  --format="value(spec.template.spec.containers[0].env)"

# 環境変数更新
gcloud run services update video-analyzer-worker \
  --region us-central1 \
  --update-env-vars "VARIABLE=value"
```

#### 4. コールドスタート遅延

**症状:**
初回リクエストが30秒以上かかる

**解決策:**
```bash
# 最小インスタンス数を1に設定 (有料)
gcloud run services update video-analyzer-worker \
  --region us-central1 \
  --min-instances 1

# または、Cloud Schedulerで定期的にウォームアップ
gcloud scheduler jobs create http warm-up-worker \
  --schedule "*/5 * * * *" \
  --uri "https://video-analyzer-worker-820467345033.us-central1.run.app/health"
```

---

## デプロイチェックリスト

### デプロイ前

- [ ] ローカルテスト成功
- [ ] TypeScriptビルド成功
- [ ] 環境変数確認
- [ ] `.env.local` と本番環境の差異確認
- [ ] GEMINI_API_KEYが設定されているか確認
- [ ] Blob自動削除機能が動作しているか確認

### デプロイ後

- [ ] ヘルスチェック成功
- [ ] フロントエンドアクセス確認
- [ ] バックエンドアクセス確認
- [ ] ログにエラーがないか確認
- [ ] 動画アップロード → 処理 → ダウンロード のE2Eテスト
- [ ] Blobが自動削除されているか確認

### 緊急時

- [ ] ロールバック手順を把握
- [ ] ログ確認方法を把握
- [ ] 連絡先を確認

---

## 今後の改善案

### 短期 (1-2週間)

1. **GEMINI_API_KEYの追加**
   - Cloud Runに環境変数追加
   - Secret Managerへの移行

2. **CI/CDパイプライン構築**
   - GitHub Actions追加
   - 自動テスト
   - 自動デプロイ

3. **モニタリング強化**
   - Sentry導入
   - アラート設定

### 中期 (1-2ヶ月)

1. **パフォーマンス最適化**
   - Cloud CDN追加
   - 画像最適化
   - キャッシュ戦略

2. **コスト最適化**
   - Blob保持期間最適化
   - Cloud Run最小インスタンス調整
   - 不要なログ削減

3. **セキュリティ強化**
   - Secret Manager移行
   - VPC Connector追加
   - ファイアウォールルール

### 長期 (3-6ヶ月)

1. **マルチリージョン対応**
   - アジア地域への展開
   - レイテンシー改善

2. **スケーラビリティ向上**
   - キュー導入 (Pub/Sub)
   - ワーカープール

3. **高可用性**
   - マルチリージョンデプロイ
   - フェイルオーバー設定

---

## 参考リンク

- [Vercel Documentation](https://vercel.com/docs)
- [Cloud Run Documentation](https://cloud.google.com/run/docs)
- [Next.js Deployment](https://nextjs.org/docs/deployment)
- [Supabase Documentation](https://supabase.com/docs)

---

**最終更新:** 2025-11-01
**バージョン:** 2.0.0
