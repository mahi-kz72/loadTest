#!/bin/bash

set -euo pipefail

# Run all spike and breakpoint tests and generate HTML/JSON reports

K6_BIN=${K6_BIN:-"./k6"}
BASE_URL=${BASE_URL:-"https://testnetapiv2.nobitex.ir"}
ACCESS_TOKEN=${ACCESS_TOKEN:-"340d8cd1b7afcde2ca72050f9da6783cad0a1b60"}
AUTH_SCHEME=${AUTH_SCHEME:-"Token"}

# UTM defaults
UTM_CAMPAIGN=${UTM_CAMPAIGN:-"multistep_payout:base:crypto_champions_2:public"}
UTM_SOURCE=${UTM_SOURCE:-"snapp"}
UTM_MEDIUM=${UTM_MEDIUM:-"banner"}

mkdir -p reports

echo "=== Running SPIKE tests ==="

echo "[1/3] campaignsList_spike_test.js"
${K6_BIN} run spike/campaignsList_spike_test.js \
  -e BASE_URL="${BASE_URL}" \
  -e ACCESS_TOKEN="${ACCESS_TOKEN}" \
  -e AUTH_SCHEME="${AUTH_SCHEME}" \
  -e UTM_CAMPAIGN="${UTM_CAMPAIGN}" \
  -e UTM_SOURCE="${UTM_SOURCE}" \
  -e UTM_MEDIUM="${UTM_MEDIUM}"

echo "[2/3] campaignInfo_spike_test.js"
${K6_BIN} run spike/campaignInfo_spike_test.js \
  -e BASE_URL="${BASE_URL}" \
  -e ACCESS_TOKEN="${ACCESS_TOKEN}" \
  -e AUTH_SCHEME="${AUTH_SCHEME}" \
  -e UTM_CAMPAIGN="${UTM_CAMPAIGN}" \
  -e UTM_SOURCE="${UTM_SOURCE}" \
  -e UTM_MEDIUM="${UTM_MEDIUM}"

echo "[3/3] rewardCapacity_spike_test.js"
${K6_BIN} run spike/rewardCapacity_spike_test.js \
  -e BASE_URL="${BASE_URL}" \
  -e ACCESS_TOKEN="${ACCESS_TOKEN}" \
  -e AUTH_SCHEME="${AUTH_SCHEME}"

echo "=== Running BREAKPOINT tests (expects whitelist) ==="

# Shared breakpoint ramp defaults (tune as needed)
RAMP_START=${RAMP_START:-50}
RAMP_PEAK=${RAMP_PEAK:-800}
RAMP_STEPS=${RAMP_STEPS:-10}
STEP_SECONDS=${STEP_SECONDS:-30}
P95_SLA_MS=${P95_SLA_MS:-100}
ERROR_RATE_MAX=${ERROR_RATE_MAX:-0.01}
BREACH_CONSECUTIVE=${BREACH_CONSECUTIVE:-20}

run_bp() {
  local name=$1 file=$2
  echo "[BP] ${name}"
  ${K6_BIN} run "$file" \
    -e TEST_NAME="${name}" \
    -e EXPECT_RATE_LIMIT=true \
    -e RAMP_START="${RAMP_START}" -e RAMP_PEAK="${RAMP_PEAK}" \
    -e RAMP_STEPS="${RAMP_STEPS}" -e STEP_SECONDS="${STEP_SECONDS}" \
    -e P95_SLA_MS="${P95_SLA_MS}" -e ERROR_RATE_MAX="${ERROR_RATE_MAX}" \
    -e BREACH_CONSECUTIVE="${BREACH_CONSECUTIVE}" \
    -e BASE_URL="${BASE_URL}" -e ACCESS_TOKEN="${ACCESS_TOKEN}" -e AUTH_SCHEME="${AUTH_SCHEME}" \
    -e UTM_CAMPAIGN="${UTM_CAMPAIGN}" -e UTM_SOURCE="${UTM_SOURCE}" -e UTM_MEDIUM="${UTM_MEDIUM}"
}

run_bp campaignsList breakpoint/campaignsList_breakpoint_test.js
run_bp campaignInfo  breakpoint/campaignInfo_breakpoint_test.js
run_bp rewardCapacity breakpoint/rewardCapacity_breakpoint_test.js

echo "All tests finished. Reports are in ./reports"

#!/bin/bash

# Load Testing Script for Marketing APIs
# This script runs all three spike tests and generates individual reports

echo "🚀 Starting Load Testing for Marketing APIs..."
echo "=============================================="

# Create reports directory if it doesn't exist
mkdir -p reports

# Function to run a test and show results
run_test() {
    local test_name=$1
    local test_file=$2
    local description=$3
    
    echo ""
    echo "📊 Running $test_name test..."
    echo "Description: $description"
    echo "----------------------------------------"
    
    ./k6 run "$test_file"
    
    if [ $? -eq 0 ]; then
        echo "✅ $test_name test completed successfully!"
    else
        echo "❌ $test_name test failed!"
    fi
}

# Run all tests
run_test "Campaigns List" "spike/campaignsList_spike_test.js" "Testing GET /marketing/campaigns endpoint"
run_test "Campaign Info" "spike/campaignInfo_spike_test.js" "Testing GET /marketing/campaign endpoint"  
run_test "Reward Capacity" "spike/rewardCapacity_spike_test.js" "Testing reward capacity limits"

echo ""
echo "🎉 All tests completed!"
echo "=============================================="
echo "📁 Reports generated in the 'reports/' directory:"
echo ""
ls -la reports/
echo ""
echo "🌐 To view HTML reports, open them in your browser:"
echo "   open reports/campaignsList_summary.html"
echo "   open reports/campaignInfo_summary.html" 
echo "   open reports/rewardCapacity_summary.html"
