#!/bin/bash
# Cloud Run Worker デプロイスクリプト
# 使い方: ./deploy.sh

set -e

SERVICE_NAME="video-analyzer-worker"
REGION="us-central1"
KEEP_REVISIONS=2  # 保持するリビジョン数（最新N個）

# Git commit SHA を取得
COMMIT_SHA=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")

echo "=========================================="
echo "Cloud Run Worker Deploy Script"
echo "=========================================="
echo "Commit: $COMMIT_SHA"

# 1. ビルド（COMMIT_SHAを環境変数で渡す）
echo ""
echo "[1/5] Building..."
COMMIT_SHA=$COMMIT_SHA npm run build

# 2. デプロイ
echo ""
echo "[2/5] Deploying to Cloud Run..."
gcloud run deploy $SERVICE_NAME \
  --source . \
  --region $REGION \
  --timeout 3600 \
  --cpu 4 \
  --memory 4Gi \
  --concurrency 1 \
  --min-instances 1 \
  --max-instances 50 \
  --no-cpu-throttling \
  --execution-environment gen2 \
  --allow-unauthenticated

# 3. 最新リビジョンにトラフィックをルーティング
echo ""
echo "[3/5] Routing traffic to latest revision..."
gcloud run services update-traffic $SERVICE_NAME --region $REGION --to-latest

# 4. 古いリビジョンを削除（最新N個を保持）
echo ""
echo "[4/5] Cleaning up old revisions (keeping latest $KEEP_REVISIONS)..."
REVISIONS=$(gcloud run revisions list --service $SERVICE_NAME --region $REGION --format="value(name)" --sort-by="~createTime")
COUNT=0
for REV in $REVISIONS; do
  COUNT=$((COUNT + 1))
  if [ $COUNT -gt $KEEP_REVISIONS ]; then
    echo "  Deleting: $REV"
    gcloud run revisions delete $REV --region $REGION --quiet || true
  else
    echo "  Keeping: $REV"
  fi
done

# 5. 確認
echo ""
echo "[5/5] Verifying deployment..."
HEALTH=$(curl -s https://${SERVICE_NAME}-820467345033.${REGION}.run.app/health)
echo "Health check response:"
echo "$HEALTH" | jq .

echo ""
echo "=========================================="
echo "Deploy complete!"
echo "=========================================="
