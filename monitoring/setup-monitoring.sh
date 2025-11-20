#!/bin/bash
# Cloud Monitoring セットアップスクリプト
# 使用方法: ./monitoring/setup-monitoring.sh

set -e

PROJECT_ID="video-analyzer-worker"
REGION="us-central1"
SERVICE_NAME="video-analyzer-worker"

echo "========================================"
echo "Cloud Monitoring セットアップ"
echo "========================================"
echo "プロジェクト: $PROJECT_ID"
echo "リージョン: $REGION"
echo "サービス: $SERVICE_NAME"
echo ""

# プロジェクトIDを設定
echo "📌 GCPプロジェクトを設定中..."
gcloud config set project $PROJECT_ID

# Monitoring APIが有効か確認
echo ""
echo "📊 Monitoring APIを有効化中..."
gcloud services enable monitoring.googleapis.com
gcloud services enable logging.googleapis.com

# 通知チャネルの作成（Email）
echo ""
echo "📧 通知チャネルを作成しますか？ (y/n)"
read -r CREATE_NOTIFICATION

if [ "$CREATE_NOTIFICATION" = "y" ]; then
  echo "メールアドレスを入力してください:"
  read -r EMAIL_ADDRESS

  # Email通知チャネルを作成
  gcloud alpha monitoring channels create \
    --display-name="Primary Email Alert" \
    --type=email \
    --channel-labels=email_address="$EMAIL_ADDRESS" \
    --description="Main alert notification channel"

  echo "✅ 通知チャネルを作成しました: $EMAIL_ADDRESS"

  # 作成された通知チャネルIDを取得
  NOTIFICATION_CHANNEL_ID=$(gcloud alpha monitoring channels list \
    --filter="displayName:'Primary Email Alert'" \
    --format="value(name)")

  echo "通知チャネルID: $NOTIFICATION_CHANNEL_ID"
else
  echo "⏭️  通知チャネルの作成をスキップしました"
  NOTIFICATION_CHANNEL_ID=""
fi

# アラートポリシーを作成
echo ""
echo "🚨 アラートポリシーを作成中..."

# 各YAMLファイルからアラートポリシーを作成
# 注意: gcloud alpha monitoring policies create は YAML 全体をサポートしないため、
# 個別に作成する必要があります

# 1. エラーレート監視
echo "  - エラーレート監視ポリシー作成中..."
cat <<EOF | gcloud alpha monitoring policies create --policy-from-file=-
{
  "displayName": "Cloud Run - High Error Rate",
  "documentation": {
    "content": "Cloud Runサービスのエラー率が5%を超えています。ログを確認してください。",
    "mimeType": "text/markdown"
  },
  "conditions": [
    {
      "displayName": "Error rate > 5%",
      "conditionThreshold": {
        "filter": "resource.type = \"cloud_run_revision\" AND resource.labels.service_name = \"$SERVICE_NAME\" AND metric.type = \"run.googleapis.com/request_count\" AND metric.labels.response_code_class != \"2xx\" AND metric.labels.response_code_class != \"3xx\"",
        "comparison": "COMPARISON_GT",
        "thresholdValue": 0.05,
        "duration": "300s",
        "aggregations": [
          {
            "alignmentPeriod": "300s",
            "perSeriesAligner": "ALIGN_RATE",
            "crossSeriesReducer": "REDUCE_MEAN",
            "groupByFields": ["resource.service_name"]
          }
        ]
      }
    }
  ],
  "combiner": "OR",
  "enabled": true
}
EOF

# 2. レスポンスタイム監視
echo "  - レスポンスタイム監視ポリシー作成中..."
cat <<EOF | gcloud alpha monitoring policies create --policy-from-file=-
{
  "displayName": "Cloud Run - High Latency (p95)",
  "documentation": {
    "content": "p95レスポンスタイムが60秒を超えています。パフォーマンスを確認してください。",
    "mimeType": "text/markdown"
  },
  "conditions": [
    {
      "displayName": "p95 latency > 60s",
      "conditionThreshold": {
        "filter": "resource.type = \"cloud_run_revision\" AND resource.labels.service_name = \"$SERVICE_NAME\" AND metric.type = \"run.googleapis.com/request_latencies\"",
        "comparison": "COMPARISON_GT",
        "thresholdValue": 60000,
        "duration": "300s",
        "aggregations": [
          {
            "alignmentPeriod": "300s",
            "perSeriesAligner": "ALIGN_DELTA",
            "crossSeriesReducer": "REDUCE_PERCENTILE_95",
            "groupByFields": ["resource.service_name"]
          }
        ]
      }
    }
  ],
  "combiner": "OR",
  "enabled": true
}
EOF

# 3. メモリ使用率監視
echo "  - メモリ使用率監視ポリシー作成中..."
cat <<EOF | gcloud alpha monitoring policies create --policy-from-file=-
{
  "displayName": "Cloud Run - High Memory Usage",
  "documentation": {
    "content": "メモリ使用率が85%を超えています。メモリリークの可能性を確認してください。",
    "mimeType": "text/markdown"
  },
  "conditions": [
    {
      "displayName": "Memory utilization > 85%",
      "conditionThreshold": {
        "filter": "resource.type = \"cloud_run_revision\" AND resource.labels.service_name = \"$SERVICE_NAME\" AND metric.type = \"run.googleapis.com/container/memory/utilizations\"",
        "comparison": "COMPARISON_GT",
        "thresholdValue": 0.85,
        "duration": "300s",
        "aggregations": [
          {
            "alignmentPeriod": "300s",
            "perSeriesAligner": "ALIGN_MEAN",
            "crossSeriesReducer": "REDUCE_MEAN",
            "groupByFields": ["resource.service_name"]
          }
        ]
      }
    }
  ],
  "combiner": "OR",
  "enabled": true
}
EOF

# 4. CPU使用率監視
echo "  - CPU使用率監視ポリシー作成中..."
cat <<EOF | gcloud alpha monitoring policies create --policy-from-file=-
{
  "displayName": "Cloud Run - High CPU Usage",
  "documentation": {
    "content": "CPU使用率が90%を超えています。スケーリング設定を確認してください。",
    "mimeType": "text/markdown"
  },
  "conditions": [
    {
      "displayName": "CPU utilization > 90%",
      "conditionThreshold": {
        "filter": "resource.type = \"cloud_run_revision\" AND resource.labels.service_name = \"$SERVICE_NAME\" AND metric.type = \"run.googleapis.com/container/cpu/utilizations\"",
        "comparison": "COMPARISON_GT",
        "thresholdValue": 0.90,
        "duration": "300s",
        "aggregations": [
          {
            "alignmentPeriod": "300s",
            "perSeriesAligner": "ALIGN_MEAN",
            "crossSeriesReducer": "REDUCE_MEAN",
            "groupByFields": ["resource.service_name"]
          }
        ]
      }
    }
  ],
  "combiner": "OR",
  "enabled": true
}
EOF

echo ""
echo "✅ アラートポリシーを作成しました"

# ログベースメトリクスの作成
echo ""
echo "📝 ログベースメトリクスを作成中..."

# エラーログカウンター
gcloud logging metrics create error_log_counter \
  --description="Count of ERROR level logs" \
  --log-filter='resource.type="cloud_run_revision"
resource.labels.service_name="'"$SERVICE_NAME"'"
severity>=ERROR' \
  --value-extractor='' \
  || echo "メトリクス error_log_counter は既に存在します"

# 処理完了カウンター
gcloud logging metrics create video_processing_completed \
  --description="Count of completed video processing jobs" \
  --log-filter='resource.type="cloud_run_revision"
resource.labels.service_name="'"$SERVICE_NAME"'"
jsonPayload.message:"処理完了"' \
  --value-extractor='' \
  || echo "メトリクス video_processing_completed は既に存在します"

# 処理失敗カウンター
gcloud logging metrics create video_processing_failed \
  --description="Count of failed video processing jobs" \
  --log-filter='resource.type="cloud_run_revision"
resource.labels.service_name="'"$SERVICE_NAME"'"
jsonPayload.message:"処理失敗"' \
  --value-extractor='' \
  || echo "メトリクス video_processing_failed は既に存在します"

echo "✅ ログベースメトリクスを作成しました"

# ダッシュボードの作成
echo ""
echo "📊 モニタリングダッシュボードを作成中..."

# ダッシュボードJSON定義をインポート
if [ -f "monitoring/dashboard.json" ]; then
  gcloud monitoring dashboards create --config-from-file=monitoring/dashboard.json \
    || echo "ダッシュボードは既に存在するか、作成に失敗しました"
  echo "✅ ダッシュボードを作成しました"
else
  echo "⚠️  monitoring/dashboard.json が見つかりません。ダッシュボード作成をスキップします。"
fi

echo ""
echo "========================================"
echo "✅ セットアップ完了"
echo "========================================"
echo ""
echo "次のステップ:"
echo "1. Cloud Console でアラートポリシーを確認:"
echo "   https://console.cloud.google.com/monitoring/alerting/policies?project=$PROJECT_ID"
echo ""
echo "2. 通知チャネルを追加:"
echo "   https://console.cloud.google.com/monitoring/alerting/notifications?project=$PROJECT_ID"
echo ""
echo "3. ダッシュボードを確認:"
echo "   https://console.cloud.google.com/monitoring/dashboards?project=$PROJECT_ID"
echo ""
echo "4. ログベースメトリクスを確認:"
echo "   https://console.cloud.google.com/logs/metrics?project=$PROJECT_ID"
echo ""
