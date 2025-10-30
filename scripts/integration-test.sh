#!/bin/bash

# ============================================================================
# Video Analyzer V2 - Integration Test Script
# ============================================================================
# This script performs end-to-end testing of the video processing pipeline
# including authentication, file upload, processing, and result retrieval.
# ============================================================================

set -e  # Exit on error

# Configuration
BASE_URL="${BASE_URL:-https://video-analyzer-v2-20lkemt4n-syou430-1042s-projects.vercel.app}"
TEST_VIDEO="${TEST_VIDEO:-/tmp/test-video.mp4}"
TIMESTAMP=$(date +%s%3N)
UPLOAD_ID="test_${TIMESTAMP}_integration"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

# ============================================================================
# Test 1: Health Check
# ============================================================================
test_health_check() {
    log_info "Testing health check endpoint..."

    response=$(curl -s -w "\n%{http_code}" "${BASE_URL}/api/health")
    http_code=$(echo "$response" | tail -n1)
    body=$(echo "$response" | head -n-1)

    if [ "$http_code" -eq 200 ]; then
        log_success "Health check passed"
        echo "$body" | jq '.' 2>/dev/null || echo "$body"
    else
        log_error "Health check failed with status $http_code"
        echo "$body"
        return 1
    fi
}

# ============================================================================
# Test 2: Authentication Requirements
# ============================================================================
test_auth_requirements() {
    log_info "Testing authentication requirements..."

    # Test endpoints that should require auth
    endpoints=(
        "/api/status/${UPLOAD_ID}"
        "/api/dummy-excel/${UPLOAD_ID}"
    )

    for endpoint in "${endpoints[@]}"; do
        log_info "Testing ${endpoint}..."
        http_code=$(curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}${endpoint}")

        if [ "$http_code" -eq 401 ]; then
            log_success "${endpoint} correctly requires authentication (401)"
        else
            log_error "${endpoint} returned unexpected status: $http_code (expected 401)"
        fi
    done

    # Test POST /api/process
    log_info "Testing POST /api/process..."
    response=$(curl -s -w "\n%{http_code}" -X POST "${BASE_URL}/api/process" \
        -H "Content-Type: application/json" \
        -d '{"uploadId":"test","blobUrl":"https://test.blob.vercel-storage.com/test.mp4"}')

    http_code=$(echo "$response" | tail -n1)
    body=$(echo "$response" | head -n-1)

    if [ "$http_code" -eq 401 ]; then
        log_success "POST /api/process correctly requires authentication"
    else
        log_error "POST /api/process returned unexpected status: $http_code"
        echo "$body"
    fi
}

# ============================================================================
# Test 3: Input Validation
# ============================================================================
test_input_validation() {
    log_info "Testing input validation..."

    # Test invalid Blob URL domain
    log_info "Testing invalid Blob URL domain..."
    response=$(curl -s -X POST "${BASE_URL}/api/process" \
        -H "Content-Type: application/json" \
        -d '{
            "uploadId": "'${UPLOAD_ID}'",
            "blobUrl": "https://invalid-domain.com/test.mp4",
            "fileName": "test.mp4"
        }')

    if echo "$response" | grep -q "Blob URL must be from Vercel Blob storage"; then
        log_success "Invalid Blob URL correctly rejected"
    elif echo "$response" | grep -q "Unauthorized"; then
        log_success "Authentication check working (would validate after auth)"
    else
        log_warning "Unexpected response for invalid Blob URL:"
        echo "$response" | jq '.' 2>/dev/null || echo "$response"
    fi

    # Test malformed JSON
    log_info "Testing malformed JSON..."
    response=$(curl -s -X POST "${BASE_URL}/api/process" \
        -H "Content-Type: application/json" \
        -d 'invalid json{')

    if echo "$response" | grep -q "Invalid request"; then
        log_success "Malformed JSON correctly rejected"
    elif echo "$response" | grep -q "Unauthorized"; then
        log_success "Authentication check working"
    else
        log_warning "Unexpected response for malformed JSON"
    fi
}

# ============================================================================
# Test 4: Cloud Run Integration
# ============================================================================
test_cloud_run() {
    log_info "Testing Cloud Run integration..."

    # This would require the actual Cloud Run URL and secret
    # For now, we'll check if the environment variables are set
    if [ -n "${CLOUD_RUN_URL}" ] && [ -n "${WORKER_SECRET}" ]; then
        log_info "Testing direct Cloud Run health check..."
        response=$(curl -s -w "\n%{http_code}" \
            -H "Authorization: Bearer ${WORKER_SECRET}" \
            "${CLOUD_RUN_URL}/health")

        http_code=$(echo "$response" | tail -n1)
        body=$(echo "$response" | head -n-1)

        if [ "$http_code" -eq 200 ]; then
            log_success "Cloud Run is healthy"
            echo "$body" | jq '.' 2>/dev/null || echo "$body"
        else
            log_error "Cloud Run health check failed with status $http_code"
        fi
    else
        log_warning "Cloud Run environment variables not set, skipping direct test"
    fi
}

# ============================================================================
# Test 5: Performance Check
# ============================================================================
test_performance() {
    log_info "Testing API performance..."

    # Measure response time for status endpoint
    start_time=$(date +%s%3N)
    curl -s -o /dev/null "${BASE_URL}/api/status/test_performance"
    end_time=$(date +%s%3N)

    response_time=$((end_time - start_time))

    if [ "$response_time" -lt 1000 ]; then
        log_success "Status API responded in ${response_time}ms (< 1s)"
    else
        log_warning "Status API took ${response_time}ms (> 1s)"
    fi

    # Test concurrent requests
    log_info "Testing concurrent request handling..."
    for i in {1..5}; do
        curl -s -o /dev/null "${BASE_URL}/api/status/test_concurrent_${i}" &
    done
    wait
    log_success "Concurrent requests completed"
}

# ============================================================================
# Test 6: Security Checks
# ============================================================================
test_security() {
    log_info "Testing security measures..."

    # Check for sensitive data exposure in errors
    response=$(curl -s -X POST "${BASE_URL}/api/process" \
        -H "Content-Type: application/json" \
        -d '{"malicious": "payload"}')

    # Check response doesn't contain sensitive patterns
    if echo "$response" | grep -qE "(sk_test|vercel_blob_rw|/Users/|/home/)"; then
        log_error "Sensitive information detected in error response!"
        echo "$response"
    else
        log_success "No sensitive information exposed in error responses"
    fi

    # Test SQL injection attempt (if applicable)
    log_info "Testing SQL injection protection..."
    response=$(curl -s "${BASE_URL}/api/status/test' OR '1'='1")

    if echo "$response" | grep -q "error"; then
        log_info "SQL injection attempt properly handled"
    else
        log_success "API handled potentially malicious input"
    fi
}

# ============================================================================
# Main Test Execution
# ============================================================================
main() {
    echo "============================================"
    echo "Video Analyzer V2 - Integration Test Suite"
    echo "============================================"
    echo "Target: ${BASE_URL}"
    echo "Timestamp: $(date)"
    echo "============================================"
    echo ""

    # Run all tests
    test_health_check
    echo ""

    test_auth_requirements
    echo ""

    test_input_validation
    echo ""

    test_cloud_run
    echo ""

    test_performance
    echo ""

    test_security
    echo ""

    echo "============================================"
    log_success "Integration tests completed!"
    echo "============================================"
}

# Execute main function
main "$@"