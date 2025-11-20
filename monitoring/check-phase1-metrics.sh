#!/bin/bash
# Phase 1 Monitoring Script
# Checks progress update metrics and download performance
# Created: 2025-11-09

set -e

PROJECT_ID="video-analyzer-prod-1756704391"
SERVICE_NAME="video-analyzer-worker"
REGION="us-central1"

echo "═══════════════════════════════════════════════════════════"
echo "Phase 1 Monitoring: Download Progress Updates"
echo "═══════════════════════════════════════════════════════════"
echo ""

# Function to get log count
get_log_count() {
  local filter="$1"
  local count=$(gcloud logging read "$filter" --limit=1000 --format="value(timestamp)" 2>/dev/null | wc -l | tr -d ' ')
  echo "$count"
}

# Function to get recent logs
get_recent_logs() {
  local filter="$1"
  local limit="${2:-10}"
  gcloud logging read "$filter" \
    --limit="$limit" \
    --format="value(timestamp,textPayload)" \
    2>/dev/null
}

# 1. Check progress update success count (last 1 hour)
echo "📊 Progress Update Success (last 1 hour)"
echo "─────────────────────────────────────────────────────────"
SUCCESS_COUNT=$(get_log_count 'resource.type="cloud_run_revision" resource.labels.service_name="'$SERVICE_NAME'" textPayload=~"Progress update" textPayload:"downloading" -textPayload:"failed" timestamp>="'$(date -u -v-1H +%Y-%m-%dT%H:%M:%SZ)'"')
echo "Count: $SUCCESS_COUNT"
echo ""

# 2. Check progress update failures (last 1 hour)
echo "❌ Progress Update Failures (last 1 hour)"
echo "─────────────────────────────────────────────────────────"
FAILURE_COUNT=$(get_log_count 'resource.type="cloud_run_revision" resource.labels.service_name="'$SERVICE_NAME'" textPayload:"Progress update failed (non-fatal)" timestamp>="'$(date -u -v-1H +%Y-%m-%dT%H:%M:%SZ)'"')
echo "Count: $FAILURE_COUNT"

if [ "$FAILURE_COUNT" -gt 0 ]; then
  echo ""
  echo "Recent failures:"
  get_recent_logs 'resource.type="cloud_run_revision" textPayload:"Progress update failed"' 5
fi
echo ""

# 3. Calculate success rate
if [ "$SUCCESS_COUNT" -gt 0 ] || [ "$FAILURE_COUNT" -gt 0 ]; then
  TOTAL=$((SUCCESS_COUNT + FAILURE_COUNT))
  SUCCESS_RATE=$(awk "BEGIN {printf \"%.2f\", ($SUCCESS_COUNT / $TOTAL) * 100}")
  echo "✅ Success Rate: ${SUCCESS_RATE}%"

  if (( $(echo "$SUCCESS_RATE < 90" | bc -l) )); then
    echo "⚠️  WARNING: Success rate is below 90%!"
  fi
else
  echo "ℹ️  No progress updates in the last hour"
fi
echo ""

# 4. Check recent downloads
echo "⬇️  Recent Downloads (last 10)"
echo "─────────────────────────────────────────────────────────"
get_recent_logs 'resource.type="cloud_run_revision" textPayload=~"\[Download Video\] Completed in"' 10 | while IFS=$'\t' read -r timestamp textPayload; do
  # Extract duration from log
  duration=$(echo "$textPayload" | grep -oE '[0-9.]+s' | head -1)
  echo "$timestamp - $duration"
done
echo ""

# 5. Check recent progress updates by percentage
echo "📈 Progress Distribution (last 1 hour)"
echo "─────────────────────────────────────────────────────────"
for percent in 10 12 14 16 18 20; do
  count=$(get_log_count 'resource.type="cloud_run_revision" textPayload:"Downloading... '$percent'%" timestamp>="'$(date -u -v-1H +%Y-%m-%dT%H:%M:%SZ)'"')
  echo "${percent}%: $count occurrences"
done
echo ""

# 6. Check for any errors in the last hour
echo "🔍 Recent Errors (last 1 hour)"
echo "─────────────────────────────────────────────────────────"
ERROR_COUNT=$(get_log_count 'resource.type="cloud_run_revision" resource.labels.service_name="'$SERVICE_NAME'" severity>=ERROR timestamp>="'$(date -u -v-1H +%Y-%m-%dT%H:%M:%SZ)'"')
echo "Error count: $ERROR_COUNT"

if [ "$ERROR_COUNT" -gt 0 ]; then
  echo ""
  echo "Recent errors:"
  get_recent_logs 'resource.type="cloud_run_revision" severity>=ERROR' 5
fi
echo ""

# 7. Check current revision
echo "🚀 Current Deployment"
echo "─────────────────────────────────────────────────────────"
CURRENT_REVISION=$(gcloud run services describe $SERVICE_NAME \
  --region=$REGION \
  --format="value(status.traffic[0].revisionName)" 2>/dev/null)
echo "Revision: $CURRENT_REVISION"

if [[ "$CURRENT_REVISION" == *"00003"* ]]; then
  echo "✅ Phase 1 is deployed"
elif [[ "$CURRENT_REVISION" == *"00002"* ]]; then
  echo "⚠️  Phase 1 is NOT deployed (running revision 00002)"
else
  echo "ℹ️  Unknown revision: $CURRENT_REVISION"
fi
echo ""

echo "═══════════════════════════════════════════════════════════"
echo "Monitoring check complete"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "For real-time monitoring:"
echo "  gcloud logging tail 'resource.type=\"cloud_run_revision\"'"
echo ""
echo "For metrics dashboard:"
echo "  https://console.cloud.google.com/monitoring/metrics-explorer?project=$PROJECT_ID"
