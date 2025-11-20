#!/bin/bash

##############################################################################
# GCP Secret Manager Verification Script
#
# Purpose: Verify that all secrets are correctly stored in Secret Manager
#          and that Cloud Run service can access them.
#
# Usage:
#   ./scripts/verify-secrets.sh
#
# Prerequisites:
#   - gcloud CLI installed and authenticated
#   - Correct GCP project set
#   - Secrets already created in Secret Manager
#
##############################################################################

set -e  # Exit on error
set -u  # Exit on undefined variable

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
PROJECT_ID="${GCP_PROJECT_ID:-video-analyzer-worker}"
REGION="us-central1"
SERVICE_NAME="video-analyzer-worker"
SERVICE_ACCOUNT_EMAIL="820467345033-compute@developer.gserviceaccount.com"

echo -e "${BLUE}================================${NC}"
echo -e "${BLUE}Secret Manager Verification${NC}"
echo -e "${BLUE}================================${NC}"
echo ""

# Secrets to verify
SECRETS=(
  "OPENAI_API_KEY"
  "GEMINI_API_KEY"
  "WORKER_SECRET"
  "SUPABASE_SERVICE_ROLE_KEY"
  "BLOB_READ_WRITE_TOKEN"
  "CLERK_SECRET_KEY"
)

# Test 1: Check if secrets exist in Secret Manager
echo -e "${YELLOW}[1/5] Checking Secret Manager...${NC}"
MISSING_SECRETS=()
for SECRET_NAME in "${SECRETS[@]}"; do
  if gcloud secrets describe "${SECRET_NAME}" --project="${PROJECT_ID}" &>/dev/null; then
    echo -e "  ${GREEN}✓${NC} ${SECRET_NAME}"
  else
    echo -e "  ${RED}✗${NC} ${SECRET_NAME} (NOT FOUND)"
    MISSING_SECRETS+=("$SECRET_NAME")
  fi
done

if [ ${#MISSING_SECRETS[@]} -gt 0 ]; then
  echo -e "${RED}ERROR: Missing secrets in Secret Manager${NC}"
  exit 1
fi

# Test 2: Verify latest version exists for each secret
echo -e "${YELLOW}[2/5] Verifying secret versions...${NC}"
for SECRET_NAME in "${SECRETS[@]}"; do
  VERSION=$(gcloud secrets versions list "${SECRET_NAME}" \
    --project="${PROJECT_ID}" \
    --limit=1 \
    --format="value(name)" 2>/dev/null || echo "")

  if [ -n "${VERSION}" ]; then
    echo -e "  ${GREEN}✓${NC} ${SECRET_NAME} (latest version: ${VERSION})"
  else
    echo -e "  ${RED}✗${NC} ${SECRET_NAME} (NO VERSIONS)"
  fi
done

# Test 3: Verify IAM permissions
echo -e "${YELLOW}[3/5] Verifying IAM permissions...${NC}"
IAM_ERRORS=()
for SECRET_NAME in "${SECRETS[@]}"; do
  IAM_POLICY=$(gcloud secrets get-iam-policy "${SECRET_NAME}" \
    --project="${PROJECT_ID}" \
    --format="value(bindings.members)" 2>/dev/null || echo "")

  if echo "${IAM_POLICY}" | grep -q "serviceAccount:${SERVICE_ACCOUNT_EMAIL}"; then
    echo -e "  ${GREEN}✓${NC} ${SECRET_NAME}"
  else
    echo -e "  ${RED}✗${NC} ${SECRET_NAME} (Missing IAM binding)"
    IAM_ERRORS+=("$SECRET_NAME")
  fi
done

if [ ${#IAM_ERRORS[@]} -gt 0 ]; then
  echo -e "${YELLOW}WARNING: Some secrets missing IAM bindings. Run migration script again.${NC}"
fi

# Test 4: Verify Cloud Run service configuration
echo -e "${YELLOW}[4/5] Checking Cloud Run service configuration...${NC}"
SERVICE_EXISTS=$(gcloud run services describe "${SERVICE_NAME}" \
  --region="${REGION}" \
  --project="${PROJECT_ID}" \
  --format="value(metadata.name)" 2>/dev/null || echo "")

if [ -z "${SERVICE_EXISTS}" ]; then
  echo -e "${RED}ERROR: Cloud Run service '${SERVICE_NAME}' not found${NC}"
  exit 1
fi

# Check if secrets are referenced in Cloud Run
SECRET_CONFIG=$(gcloud run services describe "${SERVICE_NAME}" \
  --region="${REGION}" \
  --project="${PROJECT_ID}" \
  --format="value(spec.template.spec.containers[0].env[].valueFrom.secretKeyRef.name)" 2>/dev/null || echo "")

if [ -n "${SECRET_CONFIG}" ]; then
  echo -e "${GREEN}✓ Cloud Run service has secret references:${NC}"
  echo "${SECRET_CONFIG}" | while IFS= read -r secret; do
    echo -e "    - ${secret}"
  done
else
  echo -e "${YELLOW}⚠️  Cloud Run service does NOT have secret references yet${NC}"
  echo "  Run the Cloud Run update command from migration script output."
fi

# Test 5: Test Cloud Run health endpoint
echo -e "${YELLOW}[5/5] Testing Cloud Run service health...${NC}"
SERVICE_URL=$(gcloud run services describe "${SERVICE_NAME}" \
  --region="${REGION}" \
  --project="${PROJECT_ID}" \
  --format="value(status.url)" 2>/dev/null || echo "")

if [ -n "${SERVICE_URL}" ]; then
  HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "${SERVICE_URL}/health" 2>/dev/null || echo "000")

  if [ "${HTTP_STATUS}" = "200" ]; then
    echo -e "${GREEN}✓ Cloud Run service is responding (HTTP ${HTTP_STATUS})${NC}"
  else
    echo -e "${RED}✗ Cloud Run service health check failed (HTTP ${HTTP_STATUS})${NC}"
  fi
else
  echo -e "${RED}ERROR: Could not get Cloud Run service URL${NC}"
  exit 1
fi

# Test 6: Optional - Test secret value retrieval (requires permissions)
echo ""
echo -e "${BLUE}Optional: Test secret retrieval${NC}"
echo -e "${YELLOW}Testing if you can access secret values...${NC}"

TEST_SECRET="WORKER_SECRET"
TEST_VALUE=$(gcloud secrets versions access latest \
  --secret="${TEST_SECRET}" \
  --project="${PROJECT_ID}" 2>/dev/null || echo "")

if [ -n "${TEST_VALUE}" ]; then
  VALUE_LENGTH=${#TEST_VALUE}
  echo -e "${GREEN}✓ Successfully retrieved ${TEST_SECRET} (length: ${VALUE_LENGTH} chars)${NC}"
else
  echo -e "${YELLOW}⚠️  Could not retrieve secret value (may require additional permissions)${NC}"
fi

# Summary
echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}Verification Complete!${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

if [ ${#MISSING_SECRETS[@]} -eq 0 ] && [ ${#IAM_ERRORS[@]} -eq 0 ]; then
  echo -e "${GREEN}✓ All secrets verified successfully${NC}"
  echo ""
  echo "Next steps:"
  echo "  1. If Cloud Run doesn't have secret references yet, run the update command"
  echo "  2. Test video processing end-to-end"
  echo "  3. Update Vercel environment variables (remove secrets, keep public keys)"
  echo "  4. Monitor Cloud Run logs for any errors"
else
  echo -e "${YELLOW}⚠️  Some issues found. Review the output above.${NC}"
fi
echo ""
