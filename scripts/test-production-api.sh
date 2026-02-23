#!/bin/bash
# ArchiMap Production API Testing Script

BASE_URL="https://archimap-eight.vercel.app"

echo "🔍 ArchiMap Production API Debug Tool"
echo "======================================"
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Test function
test_endpoint() {
  local endpoint=$1
  local description=$2

  echo -e "${BLUE}Testing: ${description}${NC}"
  echo "URL: ${BASE_URL}${endpoint}"
  echo ""

  # Make request and capture response
  response=$(curl -s -w "\n%{http_code}" "${BASE_URL}${endpoint}")
  http_code=$(echo "$response" | tail -n1)
  body=$(echo "$response" | sed '$d')

  if [ "$http_code" = "200" ]; then
    echo -e "${GREEN}✅ Status: ${http_code}${NC}"

    # Count features if GeoJSON
    feature_count=$(echo "$body" | jq -r '.features | length' 2>/dev/null)
    if [ ! -z "$feature_count" ] && [ "$feature_count" != "null" ]; then
      echo -e "${GREEN}   Features: ${feature_count}${NC}"

      # Show first feature sample
      if [ "$feature_count" -gt "0" ]; then
        echo "   Sample feature:"
        echo "$body" | jq -r '.features[0]' 2>/dev/null | head -20
      fi
    else
      echo "   Response (first 500 chars):"
      echo "$body" | head -c 500
    fi
  else
    echo -e "${RED}❌ Status: ${http_code}${NC}"
    echo "   Error response:"
    echo "$body"
  fi

  echo ""
  echo "---"
  echo ""
}

# Test all endpoints
echo "1. Testing Regions Endpoint"
echo "----------------------------"
test_endpoint "/api/geo/regions" "Get all regions"

echo "2. Testing Departements Endpoint"
echo "---------------------------------"
test_endpoint "/api/geo/departements" "Get all departements"

echo "3. Testing Communes Endpoint (with parent)"
echo "------------------------------------------"
test_endpoint "/api/geo/communes?parent=75" "Get communes for Paris (75)"

echo "4. Testing Communes Without Parent (should fail)"
echo "------------------------------------------------"
test_endpoint "/api/geo/communes" "Get communes without parent (expected error)"

echo "5. Testing Invalid Endpoint"
echo "---------------------------"
test_endpoint "/api/geo/invalid" "Invalid level (expected error)"

echo ""
echo "======================================"
echo "🏁 Testing Complete"
echo ""
echo "If you see empty features arrays, check:"
echo "  • Supabase connection"
echo "  • Database has data in regions/departements/communes tables"
echo "  • Environment variables are set correctly in Vercel"
echo ""
