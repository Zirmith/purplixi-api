#!/bin/bash

# Purplixi API Server - Test Script
# This script tests all API endpoints to verify functionality

API_URL="http://localhost:3000"

echo "╔═══════════════════════════════════════════════════════╗"
echo "║         Purplixi API Server - Test Suite             ║"
echo "╚═══════════════════════════════════════════════════════╝"
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

# Test counter
PASSED=0
FAILED=0

# Function to test endpoint
test_endpoint() {
    local name=$1
    local method=$2
    local endpoint=$3
    local data=$4
    
    echo -ne "${BLUE}Testing:${NC} $name ... "
    
    if [ "$method" == "GET" ]; then
        response=$(curl -s -w "\n%{http_code}" "$API_URL$endpoint")
    else
        response=$(curl -s -w "\n%{http_code}" -X $method -H "Content-Type: application/json" -d "$data" "$API_URL$endpoint")
    fi
    
    http_code=$(echo "$response" | tail -n1)
    body=$(echo "$response" | sed '$d')
    
    if [ "$http_code" -ge 200 ] && [ "$http_code" -lt 300 ]; then
        echo -e "${GREEN}✓ PASSED${NC} (HTTP $http_code)"
        PASSED=$((PASSED + 1))
        return 0
    else
        echo -e "${RED}✗ FAILED${NC} (HTTP $http_code)"
        echo "   Response: $body"
        FAILED=$((FAILED + 1))
        return 1
    fi
}

# Test health check
test_endpoint "Health Check" "GET" "/health"

# Test player connect
SESSION_DATA=$(test_endpoint "Player Connect" "POST" "/api/player/connect" '{
    "username": "TestPlayer",
    "uuid": "test-uuid-123",
    "launcherVersion": "2.6.0",
    "privacy": {
        "showUsername": true,
        "showVersion": true,
        "showWorld": true,
        "showServer": false
    }
}')

# Extract session ID from response (if successful)
if [ $? -eq 0 ]; then
    SESSION_ID=$(echo "$SESSION_DATA" | grep -o '"sessionId":"[^"]*"' | cut -d'"' -f4)
    echo "   Session ID: $SESSION_ID"
fi

# Test get online players
test_endpoint "Get Online Players" "GET" "/api/players/online"

# Test get statistics
test_endpoint "Get Statistics" "GET" "/api/stats"

# Test player status update (if we have a session ID)
if [ ! -z "$SESSION_ID" ]; then
    test_endpoint "Update Player Status" "POST" "/api/player/status" "{
        \"sessionId\": \"$SESSION_ID\",
        \"status\": \"playing\",
        \"minecraftVersion\": \"1.20.1\",
        \"worldName\": \"Test World\",
        \"serverAddress\": null
    }"
    
    # Test heartbeat
    test_endpoint "Heartbeat" "POST" "/api/player/heartbeat" "{
        \"sessionId\": \"$SESSION_ID\"
    }"
    
    # Test player disconnect
    test_endpoint "Player Disconnect" "POST" "/api/player/disconnect" "{
        \"sessionId\": \"$SESSION_ID\"
    }"
else
    echo -e "${RED}⚠${NC}  Skipping status update, heartbeat, and disconnect tests (no session ID)"
fi

# Test 404 handling
echo -ne "${BLUE}Testing:${NC} 404 Error Handling ... "
response=$(curl -s -w "\n%{http_code}" "$API_URL/api/nonexistent")
http_code=$(echo "$response" | tail -n1)
if [ "$http_code" -eq 404 ]; then
    echo -e "${GREEN}✓ PASSED${NC} (HTTP $http_code)"
    PASSED=$((PASSED + 1))
else
    echo -e "${RED}✗ FAILED${NC} (Expected 404, got $http_code)"
    FAILED=$((FAILED + 1))
fi

# Summary
echo ""
echo "╔═══════════════════════════════════════════════════════╗"
echo "║                  Test Results                         ║"
echo "╚═══════════════════════════════════════════════════════╝"
echo ""
echo -e "${GREEN}Passed:${NC} $PASSED"
echo -e "${RED}Failed:${NC} $FAILED"
echo ""

if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}✓ All tests passed!${NC}"
    exit 0
else
    echo -e "${RED}✗ Some tests failed${NC}"
    exit 1
fi
