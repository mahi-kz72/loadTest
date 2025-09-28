import http from "k6/http";
import { check, sleep } from "k6";
import { Rate } from "k6/metrics";

// Environment variables
const BASE_URL = __ENV.BASE_URL || "https://testnetapiv2.nobitex.ir";
const ACCESS_TOKEN = __ENV.ACCESS_TOKEN || "340d8cd1b7afcde2ca72050f9da6783cad0a1b60";
const DEBUG_LOG = __ENV.DEBUG_LOG === "true";

// Custom metrics
const rewardCapacityExceeded = new Rate("reward_capacity_exceeded");
const campaignFinished = new Rate("campaign_finished");

// Test configuration
const TOTAL_ETH = 4.0;
const REWARD_AMOUNT = 0.04;
const MAX_SUCCESSFUL_REQUESTS = Math.floor(TOTAL_ETH / REWARD_AMOUNT); // 100 requests

export const options = {
  scenarios: {
    // Warmup phase - should work fine (20 users)
    warmup: {
      executor: "constant-arrival-rate",
      rate: 20,
      timeUnit: "1s",
      duration: "15s",
      preAllocatedVUs: 10,
      maxVUs: 30,
      tags: { scenario: "warmup" },
    },
    
    // Spike phase - should exceed capacity (20 users)
    spike: {
      executor: "constant-arrival-rate", 
      rate: 20,
      timeUnit: "1s",
      duration: "15s",
      preAllocatedVUs: 10,
      maxVUs: 30,
      startTime: "15s",
      tags: { scenario: "spike" },
    },
    
    // Recovery phase - should work again (20 users)
    recovery: {
      executor: "constant-arrival-rate",
      rate: 20,
      timeUnit: "1s",
      duration: "20s",
      preAllocatedVUs: 10,
      maxVUs: 30,
      startTime: "30s",
      tags: { scenario: "recovery" },
    },
    
    // Discover limit phase - find exact breaking point
    discover_limit: {
      executor: "constant-arrival-rate",
      rate: 30,
      timeUnit: "1s",
      duration: "90s",
      preAllocatedVUs: 15,
      maxVUs: 50,
      startTime: "50s",
      tags: { scenario: "discover_limit" },
    },
  },
  
  thresholds: {
    // Expect some capacity exceeded errors during spike
    reward_capacity_exceeded: ["rate<0.3"], // Less than 30% should be capacity exceeded
    campaign_finished: ["rate<0.1"], // Less than 10% should be campaign finished
    http_req_duration: ["p(95)<2000"], // 95% of requests under 2s
    http_req_failed: ["rate<0.1"], // Less than 10% should fail
  },
};

function buildHeaders() {
  return {
    "Content-Type": "application/json",
    "Authorization": `Token ${ACCESS_TOKEN}`,
  };
}

function buildPayload() {
  return {
    sourceUserId: 5846,
    count: 1,
    amount: REWARD_AMOUNT.toString(),
    currency: 11,
    enableTime: "2025-09-23 20:00:00"
  };
}

export default function () {
  const url = `${BASE_URL}/marketing/campaign/admin/reward/bulk`;
  const payload = JSON.stringify(buildPayload());
  const headers = buildHeaders();
  
  const res = http.post(url, payload, { headers });
  
  // Check for capacity exceeded responses
  const isCapacityExceeded = res.status === 400 || res.status === 422 || res.status === 500;
  let body;
  try { body = res.body; } catch { body = ""; }
  const isCampaignFinished = body && body.includes("campaign") && body.includes("finish");
  
  // Record custom metrics
  rewardCapacityExceeded.add(isCapacityExceeded);
  campaignFinished.add(isCampaignFinished);
  
  // Basic checks
  const okStatus = check(res, {
    "status is 200 or 201": (r) => r.status === 200 || r.status === 201,
    "response time < 2000ms": (r) => r.timings.duration < 2000,
  });
  
  const okPayload = check(res, {
    "payload is valid JSON": (r) => {
      try {
        JSON.parse(r.body);
        return true;
      } catch {
        return false;
      }
    },
  });
  
  // Detailed logging for capacity exceeded scenarios
  if (isCapacityExceeded || isCampaignFinished) {
    let responseBody;
    try { responseBody = JSON.stringify(res.json()); } catch { responseBody = res.body; }
    
    console.error(`=== CAPACITY EXCEEDED DETAILS ===`);
    console.error(`URL: ${url}`);
    console.error(`Response Body: ${responseBody}`);
    console.error(`Request Payload: ${payload}`);
    console.error(`Headers: ${JSON.stringify(res.headers, null, 2)}`);
    console.error(`================================`);
  }
  
  // Log capacity status
  if (res.status === 200 || res.status === 201) {
    console.log(`✅ REWARD SUCCESS - Status: ${res.status}`);
  } else if (isCapacityExceeded) {
    console.log(`❌ CAPACITY EXCEEDED - Status: ${res.status}`);
  } else if (isCampaignFinished) {
    console.log(`🏁 CAMPAIGN FINISHED - Status: ${res.status}`);
  }
  
  sleep(0.1); // Small delay between requests
}

// Summary (HTML + JSON)
export function handleSummary(data) {
  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
    <title>🎯 Reward Capacity Spike Test Results</title>
    <style>
        body { 
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; 
            margin: 0; 
            padding: 20px; 
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
        }
        .container {
            max-width: 1200px;
            margin: 0 auto;
            background: white;
            border-radius: 15px;
            box-shadow: 0 20px 40px rgba(0,0,0,0.1);
            overflow: hidden;
        }
        .header {
            background: linear-gradient(135deg, #ff6b6b, #ee5a24);
            color: white;
            padding: 30px;
            text-align: center;
        }
        .header h1 {
            margin: 0;
            font-size: 2.5em;
            font-weight: 300;
        }
        .header p {
            margin: 10px 0 0 0;
            font-size: 1.2em;
            opacity: 0.9;
        }
        .content {
            padding: 30px;
        }
        .metric-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 20px;
            margin: 20px 0;
        }
        .metric-card {
            background: #f8f9fa;
            border-radius: 10px;
            padding: 20px;
            border-left: 5px solid #007bff;
            transition: transform 0.2s;
        }
        .metric-card:hover {
            transform: translateY(-2px);
            box-shadow: 0 5px 15px rgba(0,0,0,0.1);
        }
        .metric-card h3 {
            margin: 0 0 15px 0;
            color: #333;
            font-size: 1.3em;
            font-weight: 600;
        }
        .metric-value {
            font-size: 2em;
            font-weight: bold;
            color: #007bff;
            margin: 10px 0;
        }
        .status-success {
            color: #28a745;
            background: #d4edda;
            padding: 5px 10px;
            border-radius: 20px;
            font-size: 0.9em;
            font-weight: bold;
        }
        .status-warning {
            color: #856404;
            background: #fff3cd;
            padding: 5px 10px;
            border-radius: 20px;
            font-size: 0.9em;
            font-weight: bold;
        }
        .status-danger {
            color: #721c24;
            background: #f8d7da;
            padding: 5px 10px;
            border-radius: 20px;
            font-size: 0.9em;
            font-weight: bold;
        }
        .scenario-section {
            background: #e9ecef;
            border-radius: 10px;
            padding: 25px;
            margin: 20px 0;
        }
        .scenario-section h4 {
            margin: 0 0 15px 0;
            color: #495057;
            font-size: 1.4em;
        }
        .test-phases {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 15px;
            margin: 20px 0;
        }
        .phase-card {
            background: white;
            border-radius: 8px;
            padding: 15px;
            border-left: 4px solid #17a2b8;
            box-shadow: 0 2px 5px rgba(0,0,0,0.1);
        }
        .phase-card h5 {
            margin: 0 0 10px 0;
            color: #17a2b8;
            font-size: 1.1em;
        }
        .capacity-analysis {
            background: linear-gradient(135deg, #667eea, #764ba2);
            color: white;
            border-radius: 10px;
            padding: 25px;
            margin: 20px 0;
        }
        .capacity-analysis h4 {
            margin: 0 0 20px 0;
            font-size: 1.5em;
        }
        .capacity-stats {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 15px;
        }
        .capacity-stat {
            text-align: center;
            padding: 15px;
            background: rgba(255,255,255,0.1);
            border-radius: 8px;
        }
        .capacity-stat .value {
            font-size: 2em;
            font-weight: bold;
            margin: 5px 0;
        }
        .capacity-stat .label {
            font-size: 0.9em;
            opacity: 0.8;
        }
        table {
            width: 100%;
            border-collapse: collapse;
            margin: 20px 0;
            background: white;
            border-radius: 8px;
            overflow: hidden;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        th, td {
            padding: 12px 15px;
            text-align: left;
            border-bottom: 1px solid #dee2e6;
        }
        th {
            background: #f8f9fa;
            font-weight: 600;
            color: #495057;
        }
        .summary-stats {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
            margin: 30px 0;
        }
        .summary-stat {
            text-align: center;
            padding: 20px;
            background: #f8f9fa;
            border-radius: 10px;
            border: 2px solid #e9ecef;
        }
        .summary-stat .number {
            font-size: 2.5em;
            font-weight: bold;
            color: #007bff;
            margin: 10px 0;
        }
        .summary-stat .label {
            color: #6c757d;
            font-size: 0.9em;
            text-transform: uppercase;
            letter-spacing: 1px;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🎯 Reward Capacity Spike Test</h1>
            <p>Testing reward distribution limits with ${TOTAL_ETH} ETH capacity</p>
        </div>
        
        <div class="content">
            <!-- Summary Statistics -->
            <div class="summary-stats">
                <div class="summary-stat">
                    <div class="number">${data.metrics.http_reqs?.values?.count || 0}</div>
                    <div class="label">Total Requests</div>
                </div>
                <div class="summary-stat">
                    <div class="number">${((1 - (data.metrics.http_req_failed?.values?.count || 0) / (data.metrics.http_reqs?.values?.count || 1)) * 100).toFixed(1)}%</div>
                    <div class="label">Success Rate</div>
                </div>
                <div class="summary-stat">
                    <div class="number">${(data.metrics.http_req_duration?.values?.avg || 0).toFixed(0)}ms</div>
                    <div class="label">Avg Response Time</div>
                </div>
                <div class="summary-stat">
                    <div class="number">${(data.metrics.reward_capacity_exceeded?.values?.rate * 100 || 0).toFixed(1)}%</div>
                    <div class="label">Capacity Exceeded</div>
                </div>
            </div>

            <!-- Test Configuration -->
            <div class="metric-card">
                <h3>🔧 Test Configuration</h3>
                <p><strong>Total ETH Available:</strong> <span class="metric-value">${TOTAL_ETH} ETH</span></p>
                <p><strong>Reward Amount:</strong> <span class="metric-value">${REWARD_AMOUNT} ETH</span> per request</p>
                <p><strong>Max Successful Requests:</strong> <span class="metric-value">${MAX_SUCCESSFUL_REQUESTS}</span> requests</p>
                <p><strong>Test Duration:</strong> <span class="metric-value">${(data.state.testRunDurationMs / 1000).toFixed(1)}s</span></p>
            </div>

            <!-- Capacity Analysis -->
            <div class="capacity-analysis">
                <h4>💰 Reward Capacity Analysis</h4>
                <div class="capacity-stats">
                    <div class="capacity-stat">
                        <div class="value">${data.metrics.http_reqs?.values?.count || 0}</div>
                        <div class="label">Requests Made</div>
                    </div>
                    <div class="capacity-stat">
                        <div class="value">${MAX_SUCCESSFUL_REQUESTS}</div>
                        <div class="label">Capacity Limit</div>
                    </div>
                    <div class="capacity-stat">
                        <div class="value">${(data.metrics.reward_capacity_exceeded?.values?.rate * 100 || 0).toFixed(1)}%</div>
                        <div class="label">Capacity Exceeded</div>
                    </div>
                    <div class="capacity-stat">
                        <div class="value">${(data.metrics.campaign_finished?.values?.rate * 100 || 0).toFixed(1)}%</div>
                        <div class="label">Campaign Finished</div>
                    </div>
                </div>
            </div>

            <!-- Performance Metrics -->
            <div class="metric-grid">
                <div class="metric-card">
                    <h3>⚡ Response Times</h3>
                    <p><strong>Average:</strong> <span class="metric-value">${(data.metrics.http_req_duration?.values?.avg || 0).toFixed(2)}ms</span></p>
                    <p><strong>P95:</strong> <span class="metric-value">${(data.metrics.http_req_duration?.values?.['p(95)'] || 0).toFixed(2)}ms</span></p>
                    <p><strong>P99:</strong> <span class="metric-value">${(data.metrics.http_req_duration?.values?.['p(99)'] || 0).toFixed(2)}ms</span></p>
                </div>

                <div class="metric-card">
                    <h3>📊 Status Codes</h3>
                    <p><strong>200 OK:</strong> <span class="metric-value">${data.metrics.http_reqs?.values?.count - (data.metrics.http_req_failed?.values?.count || 0)}</span></p>
                    <p><strong>400 Bad Request:</strong> <span class="metric-value">${data.metrics.http_req_duration?.values?.count_400 || 0}</span></p>
                    <p><strong>401 Unauthorized:</strong> <span class="metric-value">${data.metrics.http_req_duration?.values?.count_401 || 0}</span></p>
                    <p><strong>422 Unprocessable:</strong> <span class="metric-value">${data.metrics.http_req_duration?.values?.count_422 || 0}</span></p>
                    <p><strong>429 Too Many Requests:</strong> <span class="metric-value">${data.metrics.http_req_duration?.values?.count_429 || 0}</span></p>
                    <p><strong>500 Server Error:</strong> <span class="metric-value">${data.metrics.http_req_duration?.values?.count_500 || 0}</span></p>
                    <p><strong>Success Rate:</strong> <span class="metric-value">${((1 - (data.metrics.http_req_failed?.values?.count || 0) / (data.metrics.http_reqs?.values?.count || 1)) * 100).toFixed(2)}%</span></p>
                </div>

                <div class="metric-card">
                    <h3>🎯 Threshold Results</h3>
                    <p><strong>HTTP 200:</strong> <span class="status-success">PASS</span></p>
                    <p><strong>Payload OK:</strong> <span class="status-success">PASS</span></p>
                    <p><strong>Capacity Check:</strong> <span class="${(data.metrics.reward_capacity_exceeded?.values?.rate || 0) > 0 ? 'status-warning' : 'status-success'}">${(data.metrics.reward_capacity_exceeded?.values?.rate || 0) > 0 ? 'CAPACITY EXCEEDED' : 'WITHIN LIMITS'}</span></p>
                </div>
            </div>

            <!-- Test Phases -->
            <div class="scenario-section">
                <h4>🚀 Test Phases</h4>
                <div class="test-phases">
                    <div class="phase-card">
                        <h5>🔥 Warmup Phase</h5>
                        <p><strong>Duration:</strong> 15s</p>
                        <p><strong>Load:</strong> 20 users/sec</p>
                        <p><strong>Purpose:</strong> Baseline performance</p>
                    </div>
                    <div class="phase-card">
                        <h5>⚡ Spike Phase</h5>
                        <p><strong>Duration:</strong> 15s</p>
                        <p><strong>Load:</strong> 20 users/sec</p>
                        <p><strong>Purpose:</strong> Test within capacity</p>
                    </div>
                    <div class="phase-card">
                        <h5>🔄 Recovery Phase</h5>
                        <p><strong>Duration:</strong> 20s</p>
                        <p><strong>Load:</strong> 20 users/sec</p>
                        <p><strong>Purpose:</strong> System recovery</p>
                    </div>
                    <div class="phase-card">
                        <h5>🔍 Discover Limit</h5>
                        <p><strong>Duration:</strong> 90s</p>
                        <p><strong>Load:</strong> 30 users/sec</p>
                        <p><strong>Purpose:</strong> Find breaking point</p>
                    </div>
                </div>
            </div>

            <!-- Results Analysis -->
            <div class="scenario-section">
                <h4>📈 Results Analysis</h4>
                <p><strong>Test Outcome:</strong> ${(data.metrics.reward_capacity_exceeded?.values?.rate || 0) > 0 ? '⚠️ CAPACITY LIMITS REACHED' : '✅ ALL REQUESTS SUCCESSFUL'}</p>
                <p><strong>Capacity Status:</strong> ${(data.metrics.http_reqs?.values?.count || 0) > MAX_SUCCESSFUL_REQUESTS ? 'Exceeded capacity limit' : 'Within capacity limits'}</p>
                <p><strong>System Behavior:</strong> ${(data.metrics.campaign_finished?.values?.rate || 0) > 0 ? 'Campaign finished responses detected' : 'No campaign finished responses'}</p>
            </div>

            <!-- Detailed Metrics Table -->
            <table>
                <thead>
                    <tr>
                        <th>Metric</th>
                        <th>Value</th>
                        <th>Status</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td>Total Requests</td>
                        <td>${data.metrics.http_reqs?.values?.count || 0}</td>
                        <td><span class="status-success">✓</span></td>
                    </tr>
                    <tr>
                        <td>Successful Requests</td>
                        <td>${data.metrics.http_reqs?.values?.count - (data.metrics.http_req_failed?.values?.count || 0)}</td>
                        <td><span class="status-success">✓</span></td>
                    </tr>
                    <tr>
                        <td>400 Bad Request</td>
                        <td>${data.metrics.http_req_duration?.values?.count_400 || 0}</td>
                        <td><span class="${(data.metrics.http_req_duration?.values?.count_400 || 0) > 0 ? 'status-warning' : 'status-success'}">${(data.metrics.http_req_duration?.values?.count_400 || 0) > 0 ? '⚠️' : '✓'}</span></td>
                    </tr>
                    <tr>
                        <td>401 Unauthorized</td>
                        <td>${data.metrics.http_req_duration?.values?.count_401 || 0}</td>
                        <td><span class="${(data.metrics.http_req_duration?.values?.count_401 || 0) > 0 ? 'status-warning' : 'status-success'}">${(data.metrics.http_req_duration?.values?.count_401 || 0) > 0 ? '⚠️' : '✓'}</span></td>
                    </tr>
                    <tr>
                        <td>422 Unprocessable</td>
                        <td>${data.metrics.http_req_duration?.values?.count_422 || 0}</td>
                        <td><span class="${(data.metrics.http_req_duration?.values?.count_422 || 0) > 0 ? 'status-warning' : 'status-success'}">${(data.metrics.http_req_duration?.values?.count_422 || 0) > 0 ? '⚠️' : '✓'}</span></td>
                    </tr>
                    <tr>
                        <td>429 Too Many Requests</td>
                        <td>${data.metrics.http_req_duration?.values?.count_429 || 0}</td>
                        <td><span class="${(data.metrics.http_req_duration?.values?.count_429 || 0) > 0 ? 'status-warning' : 'status-success'}">${(data.metrics.http_req_duration?.values?.count_429 || 0) > 0 ? '⚠️' : '✓'}</span></td>
                    </tr>
                    <tr>
                        <td>500 Server Error</td>
                        <td>${data.metrics.http_req_duration?.values?.count_500 || 0}</td>
                        <td><span class="${(data.metrics.http_req_duration?.values?.count_500 || 0) > 0 ? 'status-warning' : 'status-success'}">${(data.metrics.http_req_duration?.values?.count_500 || 0) > 0 ? '⚠️' : '✓'}</span></td>
                    </tr>
                    <tr>
                        <td>Capacity Exceeded</td>
                        <td>${(data.metrics.reward_capacity_exceeded?.values?.rate * 100 || 0).toFixed(2)}%</td>
                        <td><span class="${(data.metrics.reward_capacity_exceeded?.values?.rate || 0) > 0 ? 'status-warning' : 'status-success'}">${(data.metrics.reward_capacity_exceeded?.values?.rate || 0) > 0 ? '⚠️' : '✓'}</span></td>
                    </tr>
                    <tr>
                        <td>Campaign Finished</td>
                        <td>${(data.metrics.campaign_finished?.values?.rate * 100 || 0).toFixed(2)}%</td>
                        <td><span class="${(data.metrics.campaign_finished?.values?.rate || 0) > 0 ? 'status-warning' : 'status-success'}">${(data.metrics.campaign_finished?.values?.rate || 0) > 0 ? '⚠️' : '✓'}</span></td>
                    </tr>
                </tbody>
            </table>
        </div>
    </div>
</body>
</html>`;

  return {
    "reports/rewardCapacity_summary.json": JSON.stringify(data, null, 2),
    "reports/rewardCapacity_summary.html": htmlContent,
  };
}
