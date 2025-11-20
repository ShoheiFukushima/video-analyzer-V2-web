# モニタリング運用ガイド

本番環境の可観測性とアラート設定の運用ガイドです。

## 📋 目次

1. [セットアップ](#セットアップ)
2. [モニタリング構成](#モニタリング構成)
3. [アラート対応手順](#アラート対応手順)
4. [定期メンテナンス](#定期メンテナンス)
5. [トラブルシューティング](#トラブルシューティング)

---

## セットアップ

### 前提条件

- Google Cloud SDK インストール済み
- GCPプロジェクト `video-analyzer-worker` へのアクセス権
- `gcloud` CLI認証済み（`gcloud auth login`）

### 初回セットアップ

```bash
# 1. モニタリング設定スクリプトを実行
cd /path/to/video-analyzer-V2-web
chmod +x monitoring/setup-monitoring.sh
./monitoring/setup-monitoring.sh

# 2. 通知チャネルを設定（プロンプトに従う）
# メールアドレスを入力してください: your-email@example.com

# 3. Uptime Checksを作成（オプション）
gcloud monitoring uptime-checks create cloud-run-worker-health \
  --display-name="Cloud Run Worker Health Check" \
  --resource-type=uptime-url \
  --host=video-analyzer-worker-820467345033.us-central1.run.app \
  --path=/health \
  --protocol=https \
  --check-interval=5m \
  --timeout=10s

gcloud monitoring uptime-checks create vercel-frontend-health \
  --display-name="Vercel Frontend Health Check" \
  --resource-type=uptime-url \
  --host=video-analyzer-v2-web.vercel.app \
  --path=/api/health \
  --protocol=https \
  --check-interval=5m \
  --timeout=10s
```

### ヘルスチェックスクリプトの設定

```bash
# 1. 環境変数を設定
cat >> .env.local <<EOF
CLOUD_RUN_URL=https://video-analyzer-worker-820467345033.us-central1.run.app
VERCEL_URL=https://video-analyzer-v2-web.vercel.app
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/WEBHOOK/URL
EOF

# 2. Cronジョブを設定（5分ごと）
crontab -e

# 以下を追加:
*/5 * * * * cd /path/to/video-analyzer-V2-web && npx tsx monitoring/health-check.ts >> /tmp/health-check.log 2>&1

# 3. 手動実行でテスト
npx tsx monitoring/health-check.ts
```

### Slack通知の設定（オプション）

1. Slack Workspaceで Incoming Webhook を作成
   - https://api.slack.com/messaging/webhooks
2. Webhook URLを `.env.local` に追加
3. テスト実行して通知を確認

---

## モニタリング構成

### Cloud Run メトリクス

| メトリクス | 閾値 | 説明 |
|-----------|------|------|
| エラーレート | > 5% | 5分間のエラー率が5%を超えた場合 |
| レスポンスタイム (p95) | > 60秒 | 95パーセンタイルのレイテンシーが60秒を超えた場合 |
| メモリ使用率 | > 85% | メモリ使用率が85%を超えた場合 |
| CPU使用率 | > 90% | CPU使用率が90%を超えた場合 |
| インスタンス数 | >= 9 | インスタンス数が最大値(10)に近づいた場合 |

### Vercel メトリクス

Vercelの監視は以下で実施:
- **Vercel Dashboard**: デプロイ状態、ビルドエラー
- **Uptime Check**: `/api/health` エンドポイント監視（5分間隔）
- **カスタムスクリプト**: `monitoring/health-check.ts`

### ログベースメトリクス

| メトリクス名 | 説明 |
|------------|------|
| `error_log_counter` | ERROR以上のログ数 |
| `video_processing_completed` | 動画処理完了数 |
| `video_processing_failed` | 動画処理失敗数 |

### ダッシュボード

Cloud Consoleで確認:
```
https://console.cloud.google.com/monitoring/dashboards?project=video-analyzer-worker
```

ダッシュボードには以下が表示されます:
- リクエスト数
- エラーレート
- レスポンスタイム (p50, p95, p99)
- CPU/メモリ使用率
- インスタンス数
- ログベースメトリクス

---

## アラート対応手順

### 1. エラーレート高騰アラート

**症状**: Cloud Runのエラー率が5%を超えています

**即座の対応**:

```bash
# 1. エラーログを確認
gcloud run services logs tail video-analyzer-worker \
  --region us-central1 \
  --filter "severity>=ERROR" \
  --limit 100

# 2. 最新のデプロイを確認
gcloud run revisions list \
  --service video-analyzer-worker \
  --region us-central1 \
  --limit 5

# 3. 必要であればロールバック
gcloud run services update-traffic video-analyzer-worker \
  --region us-central1 \
  --to-revisions video-analyzer-worker-00001=100
```

**根本原因の調査**:
- 最近のコード変更を確認
- 依存サービス（Gemini API、OpenAI API）の状態確認
- Supabaseの接続状態確認
- Blob Storageの容量確認

### 2. レスポンスタイム高騰アラート

**症状**: p95レスポンスタイムが60秒を超えています

**即座の対応**:

```bash
# 1. Cloud Traceで遅いリクエストを特定
# Cloud Console: https://console.cloud.google.com/traces/list?project=video-analyzer-worker

# 2. CPU/メモリ使用率を確認
gcloud run services describe video-analyzer-worker \
  --region us-central1 \
  --format="value(spec.template.spec.containers[0].resources)"

# 3. 同時実行数を確認
gcloud monitoring time-series list \
  --filter='metric.type="run.googleapis.com/container/instance_count"' \
  --format="table(metric.labels.service_name, points[0].value.int64Value)"
```

**対策**:
- FFmpeg処理の最適化
- AI API呼び出しのタイムアウト調整
- CPU/メモリ割り当ての増加を検討
- スケーリング設定の調整

### 3. メモリ使用率高騰アラート

**症状**: メモリ使用率が85%を超えています

**即座の対応**:

```bash
# 1. メモリリークの確認
gcloud run services logs tail video-analyzer-worker \
  --region us-central1 \
  --filter "jsonPayload.message:memory OR jsonPayload.message:OOM"

# 2. 動画サイズ制限を確認
# app/api/upload/route.ts の MAX_FILE_SIZE を確認

# 3. メモリ割り当てを増加
gcloud run services update video-analyzer-worker \
  --region us-central1 \
  --memory 4Gi
```

**根本原因の調査**:
- FFmpegプロセスが正しく終了しているか
- 一時ファイルが削除されているか
- Blob Storageの自動削除が動作しているか

### 4. Vercel Blob容量警告

**症状**: Blob Storage使用量が800MB（上限1GBの80%）を超えています

**即座の対応**:

```bash
# 1. Blob使用量を確認
npx tsx scripts/list-blob-storage.ts

# 2. 古いファイルを削除
npx dotenv -e .env.local tsx scripts/cleanup-blob-storage.ts delete-all

# 3. 自動削除機能を確認
# cloud-run-worker/src/services/videoProcessor.ts
# app/api/download/route.ts
```

**長期対策**:
- Blob保持期間を短縮（現在は処理完了後即削除）
- Vercel Pro プランへのアップグレード（1GB → 無制限）
- 別のストレージ（GCS）への移行検討

### 5. Uptime Check失敗

**症状**: ヘルスチェックエンドポイントが応答しません

**即座の対応**:

```bash
# 1. 手動でヘルスチェック
curl https://video-analyzer-worker-820467345033.us-central1.run.app/health
curl https://video-analyzer-v2-web.vercel.app/api/health

# 2. Cloud Runステータス確認
gcloud run services describe video-analyzer-worker \
  --region us-central1 \
  --format="value(status.conditions)"

# 3. Vercelデプロイ状態確認
vercel ls --prod
```

---

## 定期メンテナンス

### 日次タスク

```bash
# 1. エラーログ確認
gcloud run services logs read video-analyzer-worker \
  --region us-central1 \
  --filter "severity>=ERROR AND timestamp>=2025-11-02T00:00:00Z" \
  --limit 50

# 2. Blob使用量確認
npx tsx scripts/list-blob-storage.ts

# 3. Supabaseジョブ状態確認
# Supabase Dashboard: https://gcwdkjyyhmqtrxvmvnvn.supabase.co
```

### 週次タスク

```bash
# 1. メトリクスレビュー
# ダッシュボードで過去7日間のトレンドを確認

# 2. アラート履歴確認
gcloud alpha monitoring policies list --format="table(displayName, enabled)"

# 3. リソース使用率の最適化
# CPU/メモリが常に低い場合はダウンサイジング検討
# 常に高い場合はアップサイジング検討
```

### 月次タスク

```bash
# 1. コスト分析
# Cloud Console: https://console.cloud.google.com/billing/

# 2. 依存関係の更新
cd cloud-run-worker
npm outdated
npm update

# 3. セキュリティパッチ適用
npm audit
npm audit fix

# 4. アラートポリシーのレビュー
# 誤検知が多い場合は閾値調整
```

---

## トラブルシューティング

### ログが表示されない

**原因**: Cloud Loggingが無効、またはログレベル設定が間違っている

**解決策**:

```bash
# 1. Logging API有効化確認
gcloud services list --enabled | grep logging

# 2. ログレベル確認（cloud-run-worker/src/index.ts）
# console.log, console.error が正しく使用されているか

# 3. 構造化ログの使用
console.log(JSON.stringify({
  severity: 'INFO',
  message: 'Processing video',
  jobId: 'abc123'
}));
```

### アラートが届かない

**原因**: 通知チャネルが設定されていない

**解決策**:

```bash
# 1. 通知チャネル確認
gcloud alpha monitoring channels list

# 2. アラートポリシーに通知チャネルを追加
# Cloud Console: https://console.cloud.google.com/monitoring/alerting/policies?project=video-analyzer-worker

# 3. テスト通知送信
# アラートポリシーの "TEST" ボタンをクリック
```

### ダッシュボードにデータが表示されない

**原因**: メトリクスがまだ収集されていない、またはフィルタが間違っている

**解決策**:

```bash
# 1. メトリクスが存在するか確認
gcloud monitoring time-series list \
  --filter='metric.type="run.googleapis.com/request_count"' \
  --limit 10

# 2. サービス名が正しいか確認
# dashboard.json の "video-analyzer-worker" が正しいか

# 3. 時間範囲を広げる
# ダッシュボードで "Last 1 hour" → "Last 7 days" に変更
```

### カスタムメトリクスが送信されない

**原因**: 環境変数未設定、または @google-cloud/monitoring 未インストール

**解決策**:

```bash
# 1. @google-cloud/monitoring をインストール
npm install @google-cloud/monitoring

# 2. monitoring/custom-metrics.ts を更新してライブラリを使用

# 3. サービスアカウントキーを設定
export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account-key.json

# 4. 手動実行でテスト
npx tsx monitoring/custom-metrics.ts
```

---

## 参考リンク

### Cloud Console

- **モニタリングダッシュボード**: https://console.cloud.google.com/monitoring/dashboards?project=video-analyzer-worker
- **アラートポリシー**: https://console.cloud.google.com/monitoring/alerting/policies?project=video-analyzer-worker
- **ログエクスプローラー**: https://console.cloud.google.com/logs/query?project=video-analyzer-worker
- **Cloud Run**: https://console.cloud.google.com/run?project=video-analyzer-worker
- **Uptime Checks**: https://console.cloud.google.com/monitoring/uptime?project=video-analyzer-worker

### ドキュメント

- [Cloud Monitoring Documentation](https://cloud.google.com/monitoring/docs)
- [Cloud Run Monitoring](https://cloud.google.com/run/docs/monitoring)
- [Cloud Logging Query Language](https://cloud.google.com/logging/docs/view/logging-query-language)
- [Alerting Best Practices](https://cloud.google.com/monitoring/alerts/best-practices)

---

## よくある質問

### Q: アラートが多すぎて対応できません

**A**: 閾値を調整するか、アラート条件を緩和してください。

```bash
# アラートポリシーを無効化
gcloud alpha monitoring policies update POLICY_ID --no-enabled

# または閾値を変更
# Cloud Console から手動で編集
```

### Q: モニタリングのコストはいくらですか？

**A**: GCPの無料枠内で以下が利用可能です:
- Cloud Monitoring: 月間150MB（ログインジェスト無料枠の一部）
- Cloud Logging: 月間50GB
- Uptime Checks: 1つのチェックにつき月間1000回まで無料

詳細: https://cloud.google.com/stackdriver/pricing

### Q: Slack以外の通知方法はありますか？

**A**: Cloud Monitoringは以下の通知チャネルに対応しています:
- Email
- SMS（Twilio経由）
- PagerDuty
- Webhook（任意のエンドポイント）
- Cloud Pub/Sub

---

**最終更新**: 2025-11-02
**バージョン**: 1.0.0
