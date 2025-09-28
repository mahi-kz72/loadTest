import http from "k6/http";
import { check, sleep } from "k6";
import { Trend, Counter } from "k6/metrics";
import exec from "k6/execution";

// Env & Config
const BASE_URL = __ENV.BASE_URL || "https://testnetapiv2.nobitex.ir";
const ACCESS_TOKEN = String(__ENV.ACCESS_TOKEN || "").trim();
const AUTH_SCHEME = (String(__ENV.AUTH_SCHEME || "Token")).trim();


const UTM_CAMPAIGN = __ENV.UTM_CAMPAIGN || "multistep_payout:base:crypto_champions_2:public";

const UTM_SOURCE = __ENV.UTM_SOURCE || "snapp";
const UTM_MEDIUM = __ENV.UTM_MEDIUM || "banner";

const EXPECT_RATE_LIMIT = (/^(true|1)$/i).test(__ENV.EXPECT_RATE_LIMIT || "false");
const DEBUG_LOG = (/^(true|1)$/i).test(__ENV.DEBUG_LOG || "false");

// Metrics
const campaignInfo_duration = new Trend("campaignInfo_duration");
const status_400 = new Counter("status_400");
const status_401 = new Counter("status_401");
const status_429 = new Counter("status_429");
const unexpected_error = new Counter("unexpected_error");

// Options
export const options = {
  scenarios: {
    warmup:   { executor: "constant-arrival-rate", rate: 20, timeUnit: "1s", duration: "15s", preAllocatedVUs: 20, maxVUs: 100 },
    spike:    { executor: "constant-arrival-rate", startTime: "15s", rate: 60, timeUnit: "1s", duration: "15s", preAllocatedVUs: 40, maxVUs: 150 },
    recovery: { executor: "constant-arrival-rate", startTime: "30s", rate: 20, timeUnit: "1s", duration: "20s", preAllocatedVUs: 20, maxVUs: 100 },
    discover_limit: {
      executor: "ramping-arrival-rate",
      startTime: "50s",
      startRate: 60,
      timeUnit: "1s",
      preAllocatedVUs: 80,
      maxVUs: 300,
      stages: [
        { target: 120, duration: "30s" },
        { target: 180, duration: "30s" },
        { target: 240, duration: "30s" },
      ],
    },
  },
  thresholds: {
    "http_req_duration{endpoint:campaignInfo}": ["p(95)<500", "p(99)<1000"],
    "http_req_duration{endpoint:campaignInfo,scenario:spike}": ["p(95)<350"],
    "status_400{endpoint:campaignInfo}": ["count==0"],
    "status_401{endpoint:campaignInfo}": ["count==0"],
    "status_429{endpoint:campaignInfo,scenario:warmup}": ["count==0"],
    "status_429{endpoint:campaignInfo,scenario:spike}": ["count==0"],
    "status_429{endpoint:campaignInfo,scenario:recovery}": ["count==0"],
    "unexpected_error{endpoint:campaignInfo}": ["count==0"],
  },
};

// Helpers
function buildHeaders() {
  const headers = { "Content-Type": "application/json" };
  if (ACCESS_TOKEN) headers["Authorization"] = `${AUTH_SCHEME} ${ACCESS_TOKEN}`; // Token <token>
  return headers;
}

function logDebug(res, label = "campaignInfo") {
  if (!DEBUG_LOG) return;
  const rlRem =
    res.headers["X-RateLimit-Remaining"] ||
    res.headers["x-ratelimit-remaining"] ||
    "-";
  const sample = Math.random() < 0.1;
  if (sample) {
    console.log(`INFO [${label}][${res.status}] RL-Rem=${rlRem} Body=${res.body}`);
  } else {
    console.log(`INFO [${label}][${res.status}] RL-Rem=${rlRem}`);
  }
}

// Test Step
function getCampaignInfo() {
  // URL encode parameters to handle colons and special characters
  const url =
    `${BASE_URL}/marketing/campaign` +
    `?utmCampaign=${encodeURIComponent(UTM_CAMPAIGN)}` +
    `&utmSource=${encodeURIComponent(UTM_SOURCE)}` +
    `&utmMedium=${encodeURIComponent(UTM_MEDIUM)}`;

  const tags = { endpoint: "campaignInfo", scenario: exec.scenario.name };

  // چند بار اول URL رو لاگ کن تا مطمئن شیم _2 توشه
  if (__ENV.DEBUG_LOG && (getCampaignInfo._printed = (getCampaignInfo._printed || 0) + 1) <= 3) {
    console.log(`REQ URL -> ${url}`);
  }

  const res = http.get(url, {
    headers: buildHeaders(),  // Authorization: Token <token>
    tags,                     // متریک‌های built-in هم تگ می‌گیرن
    timeout: "60s",
  });

  // متریک مدت
  campaignInfo_duration.add(res.timings.duration, tags);

  // شمارنده‌ها
  if (res.status === 400) status_400.add(1, tags);
  if (res.status === 401) status_401.add(1, tags);
  if (res.status === 429) status_429.add(1, tags);
  if (res.status >= 500 || (res.status !== 200 && ![400, 401, 429].includes(res.status))) {
    unexpected_error.add(1, tags);
  }

  // چک‌ها
  const okStatus = check(res, { "HTTP 200": (r) => r.status === 200 });

  const okPayload =
    okStatus &&
    check(res, {
      "payload ok": (r) => {
        try {
          const j = r.json();
          return j && j.status === "ok" && j.details && Array.isArray(j.details.items);
        } catch (_) {
          return false;
        }
      },
    });

  // لاگ بدنه برای خطاهای مهم - Enhanced logging for 429 errors
  if (res.status === 400 || res.status === 429) {
    let body;
    try { body = JSON.stringify(res.json()); } catch { body = res.body; }
    console.error(`BODY[${tags.scenario}][status=${res.status}] ${body}`);
    
    // Special detailed logging for 429 errors to help DevOps/Backend
    if (res.status === 429) {
      console.error(`=== 429 RATE LIMIT DETAILS ===`);
      console.error(`URL: ${url}`);
      console.error(`Headers: ${JSON.stringify(res.headers, null, 2)}`);
      console.error(`Response Body: ${body}`);
      console.error(`Request Headers: ${JSON.stringify(buildHeaders(), null, 2)}`);
      console.error(`================================`);
    }
  }

  if (!EXPECT_RATE_LIMIT && (res.status === 401 || res.status === 429)) {
    console.error(`[WARN] Unexpected ${res.status} at ${url}`);
  }

  logDebug(res, "campaignInfo");
  return { okStatus, okPayload };
}

// ---------- Default VU function ----------
export default function () {
  getCampaignInfo();
}

//  Summary (HTML + JSON)
export function handleSummary(data) {
  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
    <title>k6 Test Results</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .metric { margin: 10px 0; padding: 10px; background: #f5f5f5; border-radius: 5px; }
        .metric h3 { margin: 0 0 10px 0; color: #333; }
        .metric-value { font-size: 18px; font-weight: bold; color: #2c5aa0; }
        .threshold-pass { color: green; }
        .threshold-fail { color: red; }
        table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        th { background-color: #f2f2f2; }
    </style>
</head>
<body>
    <h1>k6 Load Test Results</h1>
    
    <div class="metric">
        <h3>Test Summary</h3>
        <p><strong>Duration:</strong> ${data.state.testRunDurationMs / 1000}s</p>
        <p><strong>Total Requests:</strong> <span class="metric-value">${data.metrics.http_reqs?.values?.count || 0}</span></p>
        <p><strong>Failed Requests:</strong> <span class="metric-value">${data.metrics.http_req_failed?.values?.count || 0}</span></p>
        <p><strong>Success Rate:</strong> <span class="metric-value">${((1 - (data.metrics.http_req_failed?.values?.count || 0) / (data.metrics.http_reqs?.values?.count || 1)) * 100).toFixed(2)}%</span></p>
    </div>

    <div class="metric">
        <h3>Response Times</h3>
        <p><strong>Average:</strong> <span class="metric-value">${(data.metrics.http_req_duration?.values?.avg || 0).toFixed(2)}ms</span></p>
        <p><strong>P95:</strong> <span class="metric-value">${(data.metrics.http_req_duration?.values?.['p(95)'] || 0).toFixed(2)}ms</span></p>
        <p><strong>P99:</strong> <span class="metric-value">${(data.metrics.http_req_duration?.values?.['p(99)'] || 0).toFixed(2)}ms</span></p>
    </div>

    <div class="metric">
        <h3>Status Codes</h3>
        <p><strong>200 OK:</strong> <span class="metric-value">${data.metrics.http_reqs?.values?.count - (data.metrics.http_req_failed?.values?.count || 0)}</span></p>
        <p><strong>4xx Errors:</strong> <span class="metric-value">${data.metrics.http_req_failed?.values?.count || 0}</span></p>
    </div>

    <h2>Detailed Metrics</h2>
    <table>
        <tr><th>Metric</th><th>Value</th></tr>
        ${Object.entries(data.metrics || {}).map(([key, metric]) => 
            `<tr><td>${key}</td><td>${JSON.stringify(metric.values || metric, null, 2)}</td></tr>`
        ).join('')}
    </table>

    <h2>Thresholds</h2>
    <table>
        <tr><th>Threshold</th><th>Status</th></tr>
        ${Object.entries(data.thresholds || {}).map(([key, result]) => 
            `<tr><td>${key}</td><td class="${result.ok ? 'threshold-pass' : 'threshold-fail'}">${result.ok ? 'PASS' : 'FAIL'}</td></tr>`
        ).join('')}
    </table>
</body>
</html>`;

  return {
    "reports/campaignInfo_summary.json": JSON.stringify(data, null, 2),
    "reports/campaignInfo_summary.html": htmlContent,
  };
}

