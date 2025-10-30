#!/bin/bash

# ============================================================================
# Video Analyzer V2 - Real-time Monitoring Dashboard
# ============================================================================
# This script provides a real-time monitoring dashboard for the video analyzer
# showing health status, recent logs, and processing metrics.
# ============================================================================

# Configuration
BASE_URL="${BASE_URL:-https://video-analyzer-v2-20lkemt4n-syou430-1042s-projects.vercel.app}"
REFRESH_INTERVAL="${REFRESH_INTERVAL:-5}"  # Seconds between updates

# Colors for terminal output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
BOLD='\033[1m'
NC='\033[0m'  # No Color

# Function to clear screen and reset cursor
clear_screen() {
    printf '\033[2J\033[H'
}

# Function to draw a horizontal line
draw_line() {
    printf '%*s\n' "${COLUMNS:-80}" '' | tr ' ' '='
}

# Function to format timestamp
format_timestamp() {
    date '+%Y-%m-%d %H:%M:%S'
}

# Function to get health status
get_health_status() {
    local response=$(curl -s "${BASE_URL}/api/health" 2>/dev/null)

    if [ $? -ne 0 ]; then
        echo "OFFLINE"
        return 1
    fi

    local status=$(echo "$response" | jq -r '.status' 2>/dev/null || echo "ERROR")
    local blob_status=$(echo "$response" | jq -r '.checks.blob' 2>/dev/null || echo "false")
    local cloudrun_status=$(echo "$response" | jq -r '.checks.cloudRun' 2>/dev/null || echo "false")
    local clerk_status=$(echo "$response" | jq -r '.checks.clerk' 2>/dev/null || echo "false")

    echo "$status|$blob_status|$cloudrun_status|$clerk_status"
}

# Function to get recent Vercel logs
get_recent_logs() {
    if command -v vercel &> /dev/null; then
        vercel logs "${BASE_URL}" --limit 10 2>/dev/null | tail -10
    else
        echo "Vercel CLI not installed"
    fi
}

# Function to check Cloud Run status
check_cloud_run() {
    if [ -n "${CLOUD_RUN_URL}" ] && [ -n "${WORKER_SECRET}" ]; then
        local response=$(curl -s -w "%{http_code}" -o /dev/null \
            -H "Authorization: Bearer ${WORKER_SECRET}" \
            "${CLOUD_RUN_URL}/health" 2>/dev/null)

        if [ "$response" == "200" ]; then
            echo "HEALTHY"
        else
            echo "UNHEALTHY ($response)"
        fi
    else
        echo "NOT CONFIGURED"
    fi
}

# Function to display status icon
status_icon() {
    case "$1" in
        "true"|"healthy"|"HEALTHY")
            echo -e "${GREEN}✓${NC}"
            ;;
        "false"|"unhealthy"|"UNHEALTHY")
            echo -e "${RED}✗${NC}"
            ;;
        "degraded")
            echo -e "${YELLOW}⚠${NC}"
            ;;
        *)
            echo -e "${YELLOW}?${NC}"
            ;;
    esac
}

# Function to display the dashboard
display_dashboard() {
    clear_screen

    # Header
    echo -e "${BOLD}${CYAN}╔════════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${BOLD}${CYAN}║          Video Analyzer V2 - Monitoring Dashboard              ║${NC}"
    echo -e "${BOLD}${CYAN}╚════════════════════════════════════════════════════════════════╝${NC}"
    echo ""

    # Timestamp
    echo -e "${BLUE}Last Update:${NC} $(format_timestamp)"
    echo -e "${BLUE}Target URL:${NC} ${BASE_URL}"
    echo ""

    # Health Status Section
    echo -e "${BOLD}${MAGENTA}━━━ System Health ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

    local health_data=$(get_health_status)
    IFS='|' read -r overall_status blob_status cloudrun_status clerk_status <<< "$health_data"

    # Overall status with color
    case "$overall_status" in
        "healthy")
            echo -e "${GREEN}● System Status: HEALTHY${NC}"
            ;;
        "degraded")
            echo -e "${YELLOW}● System Status: DEGRADED${NC}"
            ;;
        "unhealthy"|"OFFLINE")
            echo -e "${RED}● System Status: UNHEALTHY${NC}"
            ;;
        *)
            echo -e "${YELLOW}● System Status: UNKNOWN${NC}"
            ;;
    esac
    echo ""

    # Component Status
    echo -e "${BOLD}Component Status:${NC}"
    echo -e "  API Server:      $(status_icon 'true') ${GREEN}Online${NC}"
    echo -e "  Blob Storage:    $(status_icon "$blob_status") $([ "$blob_status" == "true" ] && echo "${GREEN}Connected${NC}" || echo "${RED}Disconnected${NC}")"
    echo -e "  Cloud Run:       $(status_icon "$cloudrun_status") $([ "$cloudrun_status" == "true" ] && echo "${GREEN}Connected${NC}" || echo "${YELLOW}Disconnected${NC}")"
    echo -e "  Authentication:  $(status_icon "$clerk_status") $([ "$clerk_status" == "true" ] && echo "${GREEN}Configured${NC}" || echo "${RED}Not Configured${NC}")"
    echo ""

    # Cloud Run Direct Check
    echo -e "${BOLD}${MAGENTA}━━━ Cloud Run Worker ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    local cloud_run_status=$(check_cloud_run)
    echo -e "  Status: $cloud_run_status"
    echo ""

    # Performance Metrics
    echo -e "${BOLD}${MAGENTA}━━━ Performance Metrics ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

    # Test response time
    local start_time=$(date +%s%3N)
    curl -s -o /dev/null "${BASE_URL}/api/health" 2>/dev/null
    local end_time=$(date +%s%3N)
    local response_time=$((end_time - start_time))

    echo -e "  Health Check Response Time: ${response_time}ms"

    # Memory usage (if available in logs)
    echo -e "  Active Connections: N/A"
    echo -e "  Request Rate: N/A"
    echo ""

    # Recent Logs
    echo -e "${BOLD}${MAGENTA}━━━ Recent Logs ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

    if command -v vercel &> /dev/null; then
        # Get recent logs
        local logs=$(vercel logs "${BASE_URL}" --limit 5 2>/dev/null | tail -5)

        if [ -z "$logs" ]; then
            echo "  No recent logs available"
        else
            echo "$logs" | while IFS= read -r line; do
                # Color code based on log level
                if echo "$line" | grep -q "ERROR"; then
                    echo -e "  ${RED}$line${NC}"
                elif echo "$line" | grep -q "WARN"; then
                    echo -e "  ${YELLOW}$line${NC}"
                else
                    echo -e "  $line"
                fi
            done
        fi
    else
        echo "  Vercel CLI not installed - cannot fetch logs"
    fi
    echo ""

    # Footer
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "Press ${BOLD}Ctrl+C${NC} to exit | Refreshing every ${REFRESH_INTERVAL} seconds"
}

# Function to run quick tests
run_quick_test() {
    echo -e "\n${BOLD}${YELLOW}Running Quick Test Suite...${NC}"

    # Test each endpoint
    local endpoints=(
        "/api/health"
        "/api/status/test_monitor"
        "/api/dummy-excel/test_monitor"
    )

    for endpoint in "${endpoints[@]}"; do
        local start=$(date +%s%3N)
        local http_code=$(curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}${endpoint}" 2>/dev/null)
        local end=$(date +%s%3N)
        local duration=$((end - start))

        if [ "$http_code" == "200" ] || [ "$http_code" == "401" ]; then
            echo -e "  ${GREEN}✓${NC} ${endpoint} (${http_code}) - ${duration}ms"
        else
            echo -e "  ${RED}✗${NC} ${endpoint} (${http_code}) - ${duration}ms"
        fi
    done

    echo -e "\nResuming monitoring in 3 seconds..."
    sleep 3
}

# Main monitoring loop
main() {
    # Trap Ctrl+C to exit cleanly
    trap 'echo -e "\n${GREEN}Monitoring stopped.${NC}"; exit 0' INT

    echo -e "${BOLD}${GREEN}Starting Video Analyzer V2 Monitoring...${NC}"
    sleep 1

    # Main loop
    while true; do
        display_dashboard

        # Check for user input (non-blocking)
        read -t "$REFRESH_INTERVAL" -n 1 key

        if [ "$key" == "t" ] || [ "$key" == "T" ]; then
            run_quick_test
        fi
    done
}

# Check dependencies
check_dependencies() {
    if ! command -v jq &> /dev/null; then
        echo -e "${YELLOW}Warning: 'jq' is not installed. Some features may not work properly.${NC}"
        echo "Install with: brew install jq (macOS) or apt-get install jq (Linux)"
        echo ""
    fi

    if ! command -v vercel &> /dev/null; then
        echo -e "${YELLOW}Warning: Vercel CLI is not installed. Log fetching will be disabled.${NC}"
        echo "Install with: npm i -g vercel"
        echo ""
    fi
}

# Entry point
check_dependencies
main "$@"