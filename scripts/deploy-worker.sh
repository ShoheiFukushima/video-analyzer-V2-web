#!/bin/bash
# Multi-region deployment script for video-analyzer-worker
# Builds once with Cloud Build, then deploys to all regions in parallel.
#
# Usage:
#   ./scripts/deploy-worker.sh              # Deploy to all 6 regions
#   ./scripts/deploy-worker.sh us-central1  # Deploy to a single region

set -euo pipefail

SERVICE_NAME="video-analyzer-worker"
PROJECT_ID="video-analyzer-worker"
PROJECT_NUMBER="820467345033"
AR_REPO="video-analyzer-worker"
AR_LOCATION="us-central1"

# All deployed regions
ALL_REGIONS=(
  asia-northeast1
  asia-southeast1
  australia-southeast1
  europe-west1
  southamerica-east1
  us-central1
)

# Allow single-region override via CLI argument
if [ $# -ge 1 ]; then
  REGIONS=("$1")
  echo "Single-region mode: $1"
else
  REGIONS=("${ALL_REGIONS[@]}")
fi

# Cloud Run service settings (shared across all regions)
DEPLOY_FLAGS=(
  --timeout 3600
  --cpu 4
  --memory 4Gi
  --concurrency 1
  --min-instances 0
  --max-instances 50
  --no-cpu-throttling
  --execution-environment gen2
  --allow-unauthenticated
)

echo "=========================================="
echo "Video Analyzer Worker - Multi-Region Deploy"
echo "=========================================="
echo "Regions: ${REGIONS[*]}"
echo "Total:   ${#REGIONS[@]} region(s)"
echo ""

# -----------------------------------------------------------
# Step 1: Check for active processing jobs
# -----------------------------------------------------------
echo "Checking for active processing jobs..."
ACTIVE_JOBS=$(gcloud logging read \
  "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"$SERVICE_NAME\" AND textPayload:\"Starting video processing\" AND timestamp>=\"$(date -u -v-1H '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || date -u -d '1 hour ago' '+%Y-%m-%dT%H:%M:%SZ')\"" \
  --limit 5 --format="table(timestamp)" 2>/dev/null | wc -l || echo "0")

if [ "$ACTIVE_JOBS" -gt 1 ]; then
  echo "WARNING: There may be $((ACTIVE_JOBS-1)) active processing jobs in the last hour."
  echo "These jobs have checkpoints and will resume on the new revision."
  read -p "Continue with deployment? (y/N): " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Deployment cancelled."
    exit 1
  fi
fi

# -----------------------------------------------------------
# Step 2: Generate build-info.json
# -----------------------------------------------------------
echo ""
echo "Generating build-info.json..."
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR/../cloud-run-worker"
COMMIT_SHA=$(git rev-parse --short HEAD)
COMMIT_SHA=$COMMIT_SHA npm run prebuild --silent
echo "Build info: $(cat build-info.json)"

# -----------------------------------------------------------
# Step 3: Build image ONCE with Cloud Build → Artifact Registry
# -----------------------------------------------------------
IMAGE_TAG="${COMMIT_SHA}-$(date +%Y%m%d%H%M%S)"
IMAGE_URL="${AR_LOCATION}-docker.pkg.dev/${PROJECT_ID}/${AR_REPO}/${SERVICE_NAME}:${IMAGE_TAG}"

echo ""
echo "Building image: ${IMAGE_URL}"
echo "This may take 3-5 minutes..."
echo ""

gcloud builds submit \
  --project "$PROJECT_ID" \
  --tag "$IMAGE_URL" \
  --timeout=600 \
  .

echo ""
echo "✅ Image built: ${IMAGE_URL}"

# -----------------------------------------------------------
# Step 4: Deploy to all regions in PARALLEL
# -----------------------------------------------------------
echo ""
echo "Deploying to ${#REGIONS[@]} region(s) in parallel..."
echo ""

DEPLOY_PIDS=()
DEPLOY_LOGS_DIR=$(mktemp -d)

for REGION in "${REGIONS[@]}"; do
  LOG_FILE="${DEPLOY_LOGS_DIR}/${REGION}.log"

  (
    echo "[${REGION}] Starting deploy..."
    gcloud run deploy "$SERVICE_NAME" \
      --project "$PROJECT_ID" \
      --image "$IMAGE_URL" \
      --region "$REGION" \
      "${DEPLOY_FLAGS[@]}" \
      2>&1

    echo "[${REGION}] ✅ Deploy completed"
  ) > "$LOG_FILE" 2>&1 &

  DEPLOY_PIDS+=($!)
  echo "  Started deploy for ${REGION} (PID: $!)"
done

# Wait for all deploys to finish and collect results
echo ""
echo "Waiting for all deploys to complete..."

FAILED_REGIONS=()
for i in "${!REGIONS[@]}"; do
  REGION="${REGIONS[$i]}"
  PID="${DEPLOY_PIDS[$i]}"
  LOG_FILE="${DEPLOY_LOGS_DIR}/${REGION}.log"

  if wait "$PID"; then
    echo "  ✅ ${REGION} - SUCCESS"
  else
    echo "  ❌ ${REGION} - FAILED (see ${LOG_FILE})"
    FAILED_REGIONS+=("$REGION")
  fi
done

# -----------------------------------------------------------
# Step 5: Verify deployments with health checks
# -----------------------------------------------------------
echo ""
echo "Verifying deployments..."

for REGION in "${REGIONS[@]}"; do
  HEALTH_URL="https://${SERVICE_NAME}-${PROJECT_NUMBER}.${REGION}.run.app/health"
  HEALTH=$(curl -s --max-time 10 "$HEALTH_URL" 2>/dev/null || echo '{"status":"unreachable"}')
  COMMIT=$(echo "$HEALTH" | grep -o '"commit":"[^"]*"' | head -1 || echo '"commit":"unknown"')
  echo "  ${REGION}: ${COMMIT}"
done

# -----------------------------------------------------------
# Step 6: Summary
# -----------------------------------------------------------
echo ""
echo "=========================================="
if [ ${#FAILED_REGIONS[@]} -eq 0 ]; then
  echo "✅ All ${#REGIONS[@]} region(s) deployed successfully!"
else
  echo "⚠️  ${#FAILED_REGIONS[@]} region(s) FAILED: ${FAILED_REGIONS[*]}"
  echo "Check logs in: ${DEPLOY_LOGS_DIR}/"
fi
echo "Image: ${IMAGE_URL}"
echo "Commit: ${COMMIT_SHA}"
echo "=========================================="

# Cleanup log dir on full success
if [ ${#FAILED_REGIONS[@]} -eq 0 ]; then
  rm -rf "$DEPLOY_LOGS_DIR"
fi

# Exit with error if any region failed
[ ${#FAILED_REGIONS[@]} -eq 0 ]
