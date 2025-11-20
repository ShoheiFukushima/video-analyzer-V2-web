#!/bin/bash

##############################################################################
# GCP Secret Manager Migration Script
#
# Purpose: Migrate all API keys from plain-text environment variables to
#          Google Cloud Secret Manager for enhanced security.
#
# Usage:
#   ./scripts/migrate-to-secret-manager.sh
#
# Prerequisites:
#   - gcloud CLI installed and authenticated
#   - Correct GCP project set (gcloud config set project PROJECT_ID)
#   - Secret Manager API enabled (gcloud services enable secretmanager.googleapis.com)
#   - Required environment variables set in your shell session
#
# IMPORTANT:
#   - This script does NOT commit or push anything to git
#   - This script does NOT update Vercel environment variables (manual step required)
#   - Always test in development/staging first before production
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
echo -e "${BLUE}GCP Secret Manager Migration${NC}"
echo -e "${BLUE}================================${NC}"
echo ""
echo -e "Project ID: ${GREEN}${PROJECT_ID}${NC}"
echo -e "Region: ${GREEN}${REGION}${NC}"
echo -e "Service: ${GREEN}${SERVICE_NAME}${NC}"
echo ""

# Verify gcloud is authenticated
echo -e "${YELLOW}[1/7] Verifying gcloud authentication...${NC}"
if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" | grep -q "@"; then
  echo -e "${RED}ERROR: gcloud is not authenticated.${NC}"
  echo "Run: gcloud auth login"
  exit 1
fi
echo -e "${GREEN}✓ Authenticated${NC}"

# Verify Secret Manager API is enabled
echo -e "${YELLOW}[2/7] Verifying Secret Manager API...${NC}"
if ! gcloud services list --enabled --filter="name:secretmanager.googleapis.com" --format="value(name)" | grep -q "secretmanager"; then
  echo -e "${YELLOW}Secret Manager API is not enabled. Enabling...${NC}"
  gcloud services enable secretmanager.googleapis.com --project="${PROJECT_ID}"
  echo -e "${GREEN}✓ Secret Manager API enabled${NC}"
else
  echo -e "${GREEN}✓ Secret Manager API already enabled${NC}"
fi

# Define secrets to migrate
declare -A SECRETS=(
  ["OPENAI_API_KEY"]="OpenAI API Key for Whisper transcription"
  ["GEMINI_API_KEY"]="Google Gemini Vision API Key for OCR"
  ["WORKER_SECRET"]="Worker authentication secret"
  ["SUPABASE_SERVICE_ROLE_KEY"]="Supabase service role key for database"
  ["BLOB_READ_WRITE_TOKEN"]="Vercel Blob storage token"
  ["CLERK_SECRET_KEY"]="Clerk authentication secret key"
)

# Check if all required environment variables are set
echo -e "${YELLOW}[3/7] Checking required environment variables...${NC}"
MISSING_VARS=()
for SECRET_NAME in "${!SECRETS[@]}"; do
  if [ -z "${!SECRET_NAME:-}" ]; then
    MISSING_VARS+=("$SECRET_NAME")
  fi
done

if [ ${#MISSING_VARS[@]} -gt 0 ]; then
  echo -e "${RED}ERROR: Missing required environment variables:${NC}"
  for VAR in "${MISSING_VARS[@]}"; do
    echo -e "  - ${RED}${VAR}${NC}"
  done
  echo ""
  echo "Please set all required variables in your shell session:"
  echo "  export OPENAI_API_KEY='your-key-here'"
  echo "  export GEMINI_API_KEY='your-key-here'"
  echo "  # etc..."
  exit 1
fi
echo -e "${GREEN}✓ All required variables set${NC}"

# Create secrets in Secret Manager
echo -e "${YELLOW}[4/7] Creating secrets in Secret Manager...${NC}"
for SECRET_NAME in "${!SECRETS[@]}"; do
  SECRET_VALUE="${!SECRET_NAME}"
  SECRET_DESCRIPTION="${SECRETS[$SECRET_NAME]}"

  # Check if secret already exists
  if gcloud secrets describe "${SECRET_NAME}" --project="${PROJECT_ID}" &>/dev/null; then
    echo -e "  ${BLUE}→${NC} ${SECRET_NAME}: Already exists, adding new version..."
    echo -n "${SECRET_VALUE}" | gcloud secrets versions add "${SECRET_NAME}" \
      --project="${PROJECT_ID}" \
      --data-file=- \
      >/dev/null
  else
    echo -e "  ${BLUE}→${NC} ${SECRET_NAME}: Creating new secret..."
    echo -n "${SECRET_VALUE}" | gcloud secrets create "${SECRET_NAME}" \
      --project="${PROJECT_ID}" \
      --replication-policy="automatic" \
      --data-file=- \
      --labels="managed-by=migration-script,service=video-analyzer-worker" \
      >/dev/null

    # Set description (requires separate command)
    gcloud secrets update "${SECRET_NAME}" \
      --project="${PROJECT_ID}" \
      --update-labels="description=${SECRET_DESCRIPTION}" \
      >/dev/null 2>&1 || true
  fi

  echo -e "    ${GREEN}✓${NC} ${SECRET_NAME}"
done

# Grant Cloud Run service account access to secrets
echo -e "${YELLOW}[5/7] Granting Cloud Run service account access...${NC}"
for SECRET_NAME in "${!SECRETS[@]}"; do
  echo -e "  ${BLUE}→${NC} ${SECRET_NAME}..."
  gcloud secrets add-iam-policy-binding "${SECRET_NAME}" \
    --project="${PROJECT_ID}" \
    --member="serviceAccount:${SERVICE_ACCOUNT_EMAIL}" \
    --role="roles/secretmanager.secretAccessor" \
    >/dev/null 2>&1 || true
  echo -e "    ${GREEN}✓${NC}"
done

# Prepare Cloud Run update command
echo -e "${YELLOW}[6/7] Preparing Cloud Run service update...${NC}"

# Build secret references
SECRET_REFS=""
for SECRET_NAME in "${!SECRETS[@]}"; do
  SECRET_REFS="${SECRET_REFS}${SECRET_NAME}=${SECRET_NAME}:latest,"
done
SECRET_REFS="${SECRET_REFS%,}"  # Remove trailing comma

echo ""
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${YELLOW}IMPORTANT: Manual Action Required${NC}"
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "The secrets have been created in Secret Manager, but the Cloud Run"
echo "service has NOT been updated yet."
echo ""
echo "To complete the migration, run the following command:"
echo ""
echo -e "${GREEN}gcloud run services update ${SERVICE_NAME} \\${NC}"
echo -e "${GREEN}  --region ${REGION} \\${NC}"
echo -e "${GREEN}  --update-secrets \"${SECRET_REFS}\" \\${NC}"
echo -e "${GREEN}  --clear-env-vars \\${NC}"
echo -e "${GREEN}  --set-env-vars \"NODE_ENV=production\"${NC}"
echo ""
echo -e "${YELLOW}⚠️  WARNING: This will restart the Cloud Run service!${NC}"
echo ""
echo "After updating Cloud Run, you should also update Vercel environment variables:"
echo "  - Remove: SUPABASE_SERVICE_ROLE_KEY, BLOB_READ_WRITE_TOKEN, CLERK_SECRET_KEY"
echo "  - Keep: NEXT_PUBLIC_* variables (public keys are safe)"
echo ""
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

# Save rollback information
echo -e "${YELLOW}[7/7] Saving rollback information...${NC}"
BACKUP_FILE="scripts/rollback-env-vars-$(date +%Y%m%d-%H%M%S).txt"
cat > "${BACKUP_FILE}" <<EOF
# Rollback Environment Variables
# Generated: $(date)
# Use this file to restore plain-text environment variables if needed

OPENAI_API_KEY=${OPENAI_API_KEY}
GEMINI_API_KEY=${GEMINI_API_KEY}
WORKER_SECRET=${WORKER_SECRET}
SUPABASE_SERVICE_ROLE_KEY=${SUPABASE_SERVICE_ROLE_KEY}
BLOB_READ_WRITE_TOKEN=${BLOB_READ_WRITE_TOKEN}
CLERK_SECRET_KEY=${CLERK_SECRET_KEY}
EOF

echo -e "${GREEN}✓ Rollback file saved: ${BACKUP_FILE}${NC}"
echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}Migration Preparation Complete!${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "Next steps:"
echo "  1. Review the Cloud Run update command above"
echo "  2. Test in a development/staging environment first"
echo "  3. Execute the update command when ready"
echo "  4. Run verification script: ./scripts/verify-secrets.sh"
echo "  5. Update Vercel environment variables (remove secrets, keep public keys)"
echo ""
echo "Rollback instructions: See DEPLOYMENT_DESIGN.md (Secret Manager section)"
echo ""
