# モニタリングセットアップ概要

本番環境のモニタリング設定の概要と次のステップです。

## 実装済み内容

### 1. アラートポリシー定義 (6種類)

ファイル: `monitoring/alert-policies.yaml`

- ✅ Cloud Run エラーレート高騰 (> 5%)
- ✅ Cloud Run レスポンスタイム高騰 (p95 > 60秒)
- ✅ Cloud Run メモリ使用率高騰 (> 85%)
- ✅ Cloud Run CPU使用率高騰 (> 90%)
- ✅ Cloud Run 最大インスタンス到達 (>= 9)
- ✅ Vercel Blob容量警告 (> 800MB) ※カスタムメトリクス

各アラートには対応手順のドキュメントが含まれています。

### 2. ダッシュボード定義

ファイル: `monitoring/dashboard.json`

8つのパネル:
- リクエスト数
- エラーレート
- レスポンスタイム (p50, p95, p99)
- CPU使用率
- メモリ使用率
- インスタンス数
- エラーログ数
- 動画処理状況

### 3. 自動セットアップスクリプト

ファイル: `monitoring/setup-monitoring.sh`

以下を自動で設定:
- Cloud Monitoring/Logging API有効化
- アラートポリシー作成
- ログベースメトリクス作成
- ダッシュボード作成
- 通知チャネル作成（オプション）

### 4. ヘルスチェックスクリプト

ファイル: `monitoring/health-check.ts`

機能:
- Cloud Run `/health` エンドポイント監視
- Vercel `/api/health` エンドポイント監視
- Slack通知（オプション）
- Cronジョブ対応

テスト結果:
```
✅ Cloud Run Worker - OK (288ms)
✅ Vercel Frontend - OK (1512ms)
```

### 5. カスタムメトリクススクリプト

ファイル: `monitoring/custom-metrics.ts`

機能:
- Vercel Blob容量監視
- Supabaseジョブ統計監視
- Cloud Monitoringへメトリクス送信

### 6. Uptime Check定義

ファイル: `monitoring/uptime-check.yaml`

- Cloud Run Worker (5分間隔)
- Vercel Frontend (5分間隔)

### 7. 運用ガイド

- `monitoring/README.md` - クイックスタートガイド
- `monitoring/MONITORING_GUIDE.md` - 詳細な運用手順書

---

## 次のステップ

### ステップ1: セットアップスクリプト実行

```bash
cd /path/to/video-analyzer-V2-web
./monitoring/setup-monitoring.sh
```

このスクリプトで以下が設定されます:
- ✅ Cloud Monitoring API有効化
- ✅ 6つのアラートポリシー作成
- ✅ 3つのログベースメトリクス作成
- ✅ ダッシュボード作成
- ⚠️ 通知チャネル作成（オプション：メールアドレス入力が必要）

### ステップ2: Uptime Checks作成（オプション）

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

### ステップ3: ヘルスチェックスクリプトの設定

```bash
# 1. 環境変数を設定
cat >> .env.local <<EOF
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/WEBHOOK/URL
EOF

# 2. Cronジョブを設定（5分ごと）
crontab -e

# 以下を追加（*/5を実際のアスタリスクに変更）:
# */5 * * * * cd /path/to/video-analyzer-V2-web && npx tsx monitoring/health-check.ts >> /tmp/health-check.log 2>&1

# 3. テスト実行
npx tsx monitoring/health-check.ts
```

### ステップ4: ダッシュボード確認

```bash
# ブラウザでダッシュボードを開く
open "https://console.cloud.google.com/monitoring/dashboards?project=video-analyzer-worker"
```

### ステップ5: 通知チャネルの追加（推奨）

Cloud Consoleから手動で追加:
1. https://console.cloud.google.com/monitoring/alerting/notifications?project=video-analyzer-worker
2. "ADD NEW" をクリック
3. Email または Slack を選択
4. 各アラートポリシーに通知チャネルを紐付け

---

## 確認事項

### 動作確認

```bash
# 1. ヘルスチェックが成功するか
npx tsx monitoring/health-check.ts

# 2. Cloud Runログが取得できるか
gcloud run services logs tail video-analyzer-worker --region us-central1 --limit 10

# 3. アラートポリシーが作成されているか
gcloud alpha monitoring policies list

# 4. ダッシュボードが作成されているか
# Cloud Console: https://console.cloud.google.com/monitoring/dashboards?project=video-analyzer-worker
```

### 既存のヘルスチェックエンドポイント

✅ Cloud Run: `https://video-analyzer-worker-820467345033.us-central1.run.app/health`
✅ Vercel: `https://video-analyzer-v2-web.vercel.app/api/health`

両方とも正常に動作しています（テスト済み）。

---

## コスト見積もり

### GCP無料枠内で利用可能

- **Cloud Monitoring**: 月間150MB（ログインジェスト無料枠の一部）
- **Cloud Logging**: 月間50GB
- **Uptime Checks**: 1チェックにつき月間1000回まで無料

推定コスト: **$0/月** （無料枠内）

### 有料化が必要になる場合

- 大量のログ出力（50GB超過）
- 複数のUptime Checks（3つ以上）
- Cloud Trace有効化（オプション）

---

## トラブルシューティング

### セットアップスクリプトが失敗する

```bash
# 権限を確認
gcloud projects get-iam-policy video-analyzer-worker

# 必要な権限:
# - monitoring.alertPolicies.create
# - monitoring.metricDescriptors.create
# - monitoring.dashboards.create
# - logging.logMetrics.create
```

### アラートが届かない

```bash
# 通知チャネルを確認
gcloud alpha monitoring channels list

# アラートポリシーを確認
gcloud alpha monitoring policies list --format="table(displayName, enabled, notificationChannels)"
```

### ダッシュボードにデータが表示されない

1. データが収集されるまで5-10分待つ
2. サービス名が正しいか確認（`video-analyzer-worker`）
3. 時間範囲を広げる（"Last 1 hour" → "Last 7 days"）

---

## 参考ドキュメント

- **クイックスタート**: [README.md](./README.md)
- **詳細な運用手順**: [MONITORING_GUIDE.md](./MONITORING_GUIDE.md)
- **Cloud Console**: https://console.cloud.google.com/monitoring?project=video-analyzer-worker
- **Cloud Monitoring Docs**: https://cloud.google.com/monitoring/docs

---

## サポート

問題が発生した場合:

1. [MONITORING_GUIDE.md](./MONITORING_GUIDE.md) のトラブルシューティングセクションを確認
2. Cloud Consoleでログを確認
3. ヘルスチェックスクリプトを手動実行してエラーを確認

---

**最終更新**: 2025-11-02
**バージョン**: 1.0.0
