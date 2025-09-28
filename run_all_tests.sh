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
