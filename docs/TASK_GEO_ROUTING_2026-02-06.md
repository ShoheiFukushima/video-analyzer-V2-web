# タスク: 地理的ルーティングによるレイテンシ最適化

**作成日**: 2026-02-06
**ステータス**: ✅ 実装完了（デプロイ待ち）
**優先度**: 中-高

---

## 概要

ユーザーのアクセス地域に基づいて最適なCloud Runリージョンに自動ルーティングし、処理速度を向上させる機能を実装しました。

---

## 実装された機能

### 1. 地理的ルーティング

**ファイル**: `lib/geo-routing.ts`

ユーザーのIPアドレスに基づいて最適なCloud Runリージョンにルーティングします。

#### 対応リージョン（6リージョン）

| リージョン | 環境変数 | 対象地域 |
|-----------|---------|---------|
| asia-northeast1 (東京) | `CLOUD_RUN_URL_TOKYO` | 日本、韓国、台湾、香港 |
| asia-southeast1 (シンガポール) | `CLOUD_RUN_URL_SINGAPORE` | 東南アジア、インド |
| australia-southeast1 (シドニー) | `CLOUD_RUN_URL_SYDNEY` | オセアニア |
| us-central1 (アイオワ) | `CLOUD_RUN_URL_US` | 北米 |
| europe-west1 (ベルギー) | `CLOUD_RUN_URL_EU` | ヨーロッパ、中東、アフリカ |
| southamerica-east1 (サンパウロ) | `CLOUD_RUN_URL_BRAZIL` | 南米 |

### 2. Vercel Middleware統合

**ファイル**: `middleware.ts`

Vercelの`x-vercel-ip-country`ヘッダーを使用して、リクエストごとに以下のヘッダーを設定：

- `x-geo-country`: ユーザーの国コード
- `x-geo-region`: 選択されたCloud Runリージョン
- `x-target-cloud-run`: ターゲットCloud Run URL
- `x-fallback-cloud-run`: フェイルオーバーURL（カンマ区切り）

### 3. フェイルオーバー機能

**ファイル**: `app/api/process/route.ts`

プライマリリージョンが失敗した場合、自動的にフォールバックリージョンへ切り替え：

- 10秒タイムアウトで次のリージョンを試行
- 失敗したリージョンをログに記録
- すべて失敗した場合のみエラーを返す

#### フェイルオーバーチェーン

```
東京 → シンガポール → US → シドニー
シンガポール → 東京 → シドニー → US
シドニー → シンガポール → 東京 → US
US → ヨーロッパ → サンパウロ → 東京
ヨーロッパ → US → 東京 → サンパウロ
サンパウロ → US → ヨーロッパ → 東京
```

### 4. サイレントウォームアップ

**ファイル**: `app/components/VideoUploader.tsx`, `app/api/warmup/route.ts`

ページ読み込み時にバックグラウンドでCloud Runインスタンスをウォームアップ：

- ユーザーには見えない（UIフィードバックなし）
- エラーは無視（ウォームアップ失敗は許容）
- コールドスタート時間を事前に消化

### 5. FFmpeg処理パイプライン並列化

**ファイル**: `cloud-run-worker/src/services/ffmpeg.ts`

#### 並列化された処理

| 処理 | 改善前 | 改善後 |
|-----|-------|-------|
| シーン検出（3パス） | 順次実行 | `Promise.all`で並列 |
| フレーム抽出 | 順次実行 | `pLimit(10)`で並列（同時10フレーム） |
| ROI検出（4領域） | 順次実行 | `Promise.all`で並列 |

#### 期待される効果

| 改善項目 | 改善前 | 改善後 | 削減率 |
|---------|--------|--------|-------|
| シーン検出（3パス） | 18分 | 6分 | 67% |
| フレーム抽出（100枚） | 200秒 | 20秒 | 90% |
| ROI検出（4領域） | 24分 | 6分 | 75% |
| **合計処理時間** | ~45分 | ~15分 | **67%削減** |

---

## デプロイ手順

### Step 1: 各リージョンにCloud Runをデプロイ

```bash
cd cloud-run-worker

# 東京
gcloud run deploy video-analyzer-worker \
  --source . \
  --region asia-northeast1 \
  --platform managed \
  --allow-unauthenticated \
  --memory 4Gi \
  --cpu 4 \
  --timeout 600 \
  --max-instances 10 \
  --concurrency 1 \
  --no-cpu-throttling \
  --execution-environment gen2

# シンガポール
gcloud run deploy video-analyzer-worker \
  --source . \
  --region asia-southeast1 \
  --platform managed \
  --allow-unauthenticated \
  --memory 4Gi \
  --cpu 4 \
  --timeout 600 \
  --max-instances 10 \
  --concurrency 1 \
  --no-cpu-throttling \
  --execution-environment gen2

# シドニー
gcloud run deploy video-analyzer-worker \
  --source . \
  --region australia-southeast1 \
  --platform managed \
  --allow-unauthenticated \
  --memory 4Gi \
  --cpu 4 \
  --timeout 600 \
  --max-instances 10 \
  --concurrency 1 \
  --no-cpu-throttling \
  --execution-environment gen2

# US（既存）
gcloud run deploy video-analyzer-worker \
  --source . \
  --region us-central1 \
  --platform managed \
  --allow-unauthenticated \
  --memory 4Gi \
  --cpu 4 \
  --timeout 600 \
  --max-instances 10 \
  --concurrency 1 \
  --no-cpu-throttling \
  --execution-environment gen2

# ヨーロッパ
gcloud run deploy video-analyzer-worker \
  --source . \
  --region europe-west1 \
  --platform managed \
  --allow-unauthenticated \
  --memory 4Gi \
  --cpu 4 \
  --timeout 600 \
  --max-instances 10 \
  --concurrency 1 \
  --no-cpu-throttling \
  --execution-environment gen2

# サンパウロ
gcloud run deploy video-analyzer-worker \
  --source . \
  --region southamerica-east1 \
  --platform managed \
  --allow-unauthenticated \
  --memory 4Gi \
  --cpu 4 \
  --timeout 600 \
  --max-instances 10 \
  --concurrency 1 \
  --no-cpu-throttling \
  --execution-environment gen2
```

### Step 2: 各リージョンの環境変数を設定

各リージョンのCloud Runサービスに必要な環境変数を設定：

```bash
# 各リージョンで実行（例: asia-northeast1）
gcloud run services update video-analyzer-worker \
  --region asia-northeast1 \
  --update-env-vars "BLOB_READ_WRITE_TOKEN=${BLOB_READ_WRITE_TOKEN}" \
  --update-env-vars "SUPABASE_URL=${SUPABASE_URL}" \
  --update-env-vars "SUPABASE_SERVICE_ROLE_KEY=${SUPABASE_SERVICE_ROLE_KEY}" \
  --update-env-vars "OPENAI_API_KEY=${OPENAI_API_KEY}" \
  --update-env-vars "GEMINI_API_KEY=${GEMINI_API_KEY}" \
  --update-env-vars "WORKER_SECRET=${WORKER_SECRET}" \
  --update-env-vars "R2_ACCOUNT_ID=${R2_ACCOUNT_ID}" \
  --update-env-vars "R2_ACCESS_KEY_ID=${R2_ACCESS_KEY_ID}" \
  --update-env-vars "R2_SECRET_ACCESS_KEY=${R2_SECRET_ACCESS_KEY}" \
  --update-env-vars "R2_BUCKET_NAME=${R2_BUCKET_NAME}"
```

### Step 3: Vercel環境変数を設定

Vercel Dashboardまたはvercel CLIで新しい環境変数を追加：

```bash
# 各リージョンのCloud Run URLを設定
vercel env add CLOUD_RUN_URL_TOKYO production
# → https://video-analyzer-worker-xxx.asia-northeast1.run.app

vercel env add CLOUD_RUN_URL_SINGAPORE production
# → https://video-analyzer-worker-xxx.asia-southeast1.run.app

vercel env add CLOUD_RUN_URL_SYDNEY production
# → https://video-analyzer-worker-xxx.australia-southeast1.run.app

vercel env add CLOUD_RUN_URL_US production
# → https://video-analyzer-worker-xxx.us-central1.run.app

vercel env add CLOUD_RUN_URL_EU production
# → https://video-analyzer-worker-xxx.europe-west1.run.app

vercel env add CLOUD_RUN_URL_BRAZIL production
# → https://video-analyzer-worker-xxx.southamerica-east1.run.app
```

### Step 4: デプロイ確認

```bash
# 各リージョンのヘルスチェック
curl https://video-analyzer-worker-xxx.asia-northeast1.run.app/health
curl https://video-analyzer-worker-xxx.asia-southeast1.run.app/health
curl https://video-analyzer-worker-xxx.australia-southeast1.run.app/health
curl https://video-analyzer-worker-xxx.us-central1.run.app/health
curl https://video-analyzer-worker-xxx.europe-west1.run.app/health
curl https://video-analyzer-worker-xxx.southamerica-east1.run.app/health
```

---

## 検証方法

### 地理的ルーティング検証

```bash
# VPNで各国からアクセスをシミュレート
# または開発環境でヘッダーを偽装

# 日本からのアクセスをシミュレート
curl -H "x-vercel-ip-country: JP" https://video.function-eight.com/api/warmup

# 期待レスポンス: { "cloudRunUrl": "...", "country": "JP", "region": "asia-northeast1" }
```

### フェイルオーバー検証

1. プライマリリージョンのCloud Runを停止
2. 動画をアップロード
3. ログでフェイルオーバーが発生したことを確認

### 並列化効果検証

```bash
# Cloud Runログで処理時間を確認
gcloud run services logs read video-analyzer-worker \
  --region us-central1 \
  --filter "textPayload:Parallel" \
  --limit 20
```

---

## 影響を受けるファイル

### 新規作成
- `lib/geo-routing.ts` - ジオルーティング設定
- `app/api/warmup/route.ts` - ウォームアップエンドポイント

### 変更
- `middleware.ts` - ジオルーティングヘッダー追加
- `app/api/process/route.ts` - フェイルオーバーロジック追加
- `app/components/VideoUploader.tsx` - サイレントウォームアップ追加
- `cloud-run-worker/src/services/ffmpeg.ts` - 並列化実装

---

## コスト考慮事項

### サイレントウォームアップ方式
- 最小インスタンス: 0 × 6リージョン = **$0/月**
- 実際の使用量のみ課金

### 常時起動方式（参考）
- 最小インスタンス: 1 × 6リージョン = **~$1,500/月**

**採用**: サイレントウォームアップ方式（コスト効率優先）

---

## トラブルシューティング

### 問題: ウォームアップが機能しない

**確認事項**:
1. `/api/warmup`がCORS設定されているか
2. Cloud Run URLが正しく環境変数に設定されているか

### 問題: フェイルオーバーが発生しない

**確認事項**:
1. `x-fallback-cloud-run`ヘッダーがAPIに渡されているか
2. フォールバックURLが正しく設定されているか

### 問題: 並列化後も処理時間が改善しない

**確認事項**:
1. Cloud Runのメモリ・CPU設定（4 vCPU, 4GB推奨）
2. FFmpegログで並列実行されているか確認

---

## 成功指標

| 指標 | 現状 | 目標 | 実装後 |
|------|------|------|--------|
| 日本からの処理開始レイテンシ | ~500ms | <100ms | 要計測 |
| 動画ダウンロード速度（日本） | ~10 MB/s | >50 MB/s | 要計測 |
| 全体処理時間（日本ユーザー） | baseline | -30% | 要計測 |
| シーン検出時間 | ~18分 | ~6分 | 要計測 |
| フレーム抽出時間（100枚） | ~200秒 | ~20秒 | 要計測 |

---

## 今後の拡張予定

- [ ] 通知機能（ブラウザ通知、完了音、メール）
- [ ] Cloud Monitoringダッシュボード（リージョン別）
- [ ] アラート設定

---

## 変更履歴

| 日付 | 変更内容 | 担当 |
|------|----------|------|
| 2026-02-06 | 初版作成 | Claude |
| 2026-02-06 | 実装完了・デプロイ手順追加 | Claude |
