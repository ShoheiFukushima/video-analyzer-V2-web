# モニタリング設定

本番環境のCloud RunとVercelの可観測性とアラート設定を提供します。

## ディレクトリ構成

```
monitoring/
├── README.md                    # このファイル
├── MONITORING_GUIDE.md          # 運用ガイド（詳細版）
├── alert-policies.yaml          # アラートポリシー定義
├── dashboard.json               # Cloud Monitoringダッシュボード定義
├── uptime-check.yaml            # Uptime Check設定
├── setup-monitoring.sh          # 初回セットアップスクリプト
├── health-check.ts              # 統合ヘルスチェックスクリプト
└── custom-metrics.ts            # カスタムメトリクス送信スクリプト
```

## クイックスタート

### 1. 初回セットアップ

```bash
# モニタリング設定を一括作成
./monitoring/setup-monitoring.sh
```

このスクリプトで以下が自動設定されます:
- Cloud Monitoring API有効化
- アラートポリシー作成（6種類）
- ログベースメトリクス作成（3種類）
- ダッシュボード作成
- 通知チャネル作成（オプション）

### 2. ヘルスチェックの設定

```bash
# 環境変数を設定
export CLOUD_RUN_URL=https://video-analyzer-worker-820467345033.us-central1.run.app
export VERCEL_URL=https://video-analyzer-v2-web.vercel.app
export SLACK_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/WEBHOOK/URL

# 手動実行でテスト
npx tsx monitoring/health-check.ts

# Cronジョブで定期実行（5分ごと）
crontab -e
# 以下を追加:
# */5 * * * * cd /path/to/video-analyzer-V2-web && npx tsx monitoring/health-check.ts >> /tmp/health-check.log 2>&1
```

### 3. ダッシュボード確認

```bash
# ブラウザで開く
open "https://console.cloud.google.com/monitoring/dashboards?project=video-analyzer-worker"
```

---

## 主要機能

### アラートポリシー（6種類）

1. **エラーレート高騰** - エラー率 > 5%
2. **レスポンスタイム高騰** - p95レイテンシー > 60秒
3. **メモリ使用率高騰** - メモリ使用率 > 85%
4. **CPU使用率高騰** - CPU使用率 > 90%
5. **最大インスタンス到達** - インスタンス数 >= 9
6. **Blob容量警告** - ストレージ使用量 > 800MB（カスタムメトリクス）

### ログベースメトリクス（3種類）

- `error_log_counter` - ERROR以上のログカウント
- `video_processing_completed` - 処理完了ジョブ数
- `video_processing_failed` - 処理失敗ジョブ数

### ダッシュボード（8パネル）

- リクエスト数
- エラーレート
- レスポンスタイム (p50, p95, p99)
- CPU使用率
- メモリ使用率
- インスタンス数
- エラーログ数
- 動画処理状況（完了 vs 失敗）

### ヘルスチェック

- Cloud Run `/health` エンドポイント監視
- Vercel `/api/health` エンドポイント監視
- Slack通知（オプション）
- 10秒タイムアウト

---

## 使用方法

### ログ確認

```bash
# リアルタイムログ
gcloud run services logs tail video-analyzer-worker --region us-central1

# エラーログのみ
gcloud run services logs read video-analyzer-worker \
  --region us-central1 \
  --filter "severity>=ERROR" \
  --limit 50

# 過去24時間のエラー
gcloud run services logs read video-analyzer-worker \
  --region us-central1 \
  --filter "severity>=ERROR AND timestamp>=2025-11-01T00:00:00Z"
```

### メトリクス確認

```bash
# リクエスト数
gcloud monitoring time-series list \
  --filter='metric.type="run.googleapis.com/request_count" AND resource.labels.service_name="video-analyzer-worker"' \
  --format="table(metric.labels.response_code_class, points[0].value.int64Value)"

# CPU使用率
gcloud monitoring time-series list \
  --filter='metric.type="run.googleapis.com/container/cpu/utilizations" AND resource.labels.service_name="video-analyzer-worker"' \
  --format="table(points[0].value.doubleValue)"
```

### アラートポリシー管理

```bash
# 一覧表示
gcloud alpha monitoring policies list --format="table(displayName, enabled)"

# 無効化
gcloud alpha monitoring policies update POLICY_ID --no-enabled

# 有効化
gcloud alpha monitoring policies update POLICY_ID --enabled

# 削除
gcloud alpha monitoring policies delete POLICY_ID
```

### Uptime Check作成（オプション）

```bash
# Cloud Run Worker
gcloud monitoring uptime-checks create cloud-run-worker-health \
  --display-name="Cloud Run Worker Health Check" \
  --resource-type=uptime-url \
  --host=video-analyzer-worker-820467345033.us-central1.run.app \
  --path=/health \
  --protocol=https \
  --check-interval=5m \
  --timeout=10s

# Vercel Frontend
gcloud monitoring uptime-checks create vercel-frontend-health \
  --display-name="Vercel Frontend Health Check" \
  --resource-type=uptime-url \
  --host=video-analyzer-v2-web.vercel.app \
  --path=/api/health \
  --protocol=https \
  --check-interval=5m \
  --timeout=10s
```

---

## カスタムメトリクス（オプション）

### セットアップ

```bash
# @google-cloud/monitoring をインストール
npm install @google-cloud/monitoring

# GCPサービスアカウントキーを設定
export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account-key.json

# Vercel Blob トークンを設定
export BLOB_READ_WRITE_TOKEN=your_vercel_blob_token
```

### 実行

```bash
# 手動実行
npx tsx monitoring/custom-metrics.ts

# Cronジョブで定期実行（1時間ごと）
crontab -e
# 以下を追加:
# 0 * * * * cd /path/to/video-analyzer-V2-web && npx tsx monitoring/custom-metrics.ts >> /tmp/custom-metrics.log 2>&1
```

---

## トラブルシューティング

### アラートが届かない

1. 通知チャネルが設定されているか確認:
   ```bash
   gcloud alpha monitoring channels list
   ```

2. アラートポリシーに通知チャネルが紐付いているか確認:
   - Cloud Console → Monitoring → Alerting → ポリシーを選択
   - "Notification channels" セクションを確認

3. テスト通知を送信:
   - Cloud Console → アラートポリシー → "TEST" ボタン

### ダッシュボードにデータが表示されない

1. メトリクスが存在するか確認:
   ```bash
   gcloud monitoring time-series list \
     --filter='metric.type="run.googleapis.com/request_count"' \
     --limit 10
   ```

2. サービス名が正しいか確認:
   - `dashboard.json` の `video-analyzer-worker` が正しいか

3. 時間範囲を広げる:
   - ダッシュボードで "Last 1 hour" → "Last 7 days"

### カスタムメトリクスが送信されない

1. `@google-cloud/monitoring` がインストールされているか確認
2. サービスアカウントキーが正しく設定されているか確認
3. `monitoring/custom-metrics.ts` のコメントを参照してライブラリを使用

---

## コスト

GCPの無料枠内で利用可能:

- **Cloud Monitoring**: 月間150MB（ログインジェスト無料枠の一部）
- **Cloud Logging**: 月間50GB
- **Uptime Checks**: 1チェックにつき月間1000回まで無料

詳細: https://cloud.google.com/stackdriver/pricing

---

## 参考リンク

- **詳細な運用ガイド**: [MONITORING_GUIDE.md](./MONITORING_GUIDE.md)
- **Cloud Console**: https://console.cloud.google.com/monitoring?project=video-analyzer-worker
- **Cloud Monitoring Documentation**: https://cloud.google.com/monitoring/docs
- **Cloud Run Monitoring**: https://cloud.google.com/run/docs/monitoring

---

**最終更新**: 2025-11-02
**バージョン**: 1.0.0
