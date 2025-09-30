import http from "k6/http";
import { check, sleep } from "k6";
import { Trend, Counter } from "k6/metrics";
import exec from "k6/execution";

// Env & Config
const BASE_URL = __ENV.BASE_URL || "https://testnetapiv2.nobitex.ir";
const ACCESS_TOKEN = String(__ENV.ACCESS_TOKEN || "340d8cd1b7afcde2ca72050f9da6783cad0a1b60").trim();
const AUTH_SCHEME = (String(__ENV.AUTH_SCHEME || "Token")).trim();


const UTM_CAMPAIGN = __ENV.UTM_CAMPAIGN || "multistep_payout:base:crypto_champions_2:public";
const UTM_SOURCE = __ENV.UTM_SOURCE || "snapp";
const UTM_MEDIUM = __ENV.UTM_MEDIUM || "banner";

// Campaign Info endpoint (separate from campaigns list)
const CAMPAIGN_INFO_ENDPOINT = __ENV.CAMPAIGN_INFO_ENDPOINT || "/marketing/campaign";

const EXPECT_RATE_LIMIT = (/^(true|1)$/i).test(__ENV.EXPECT_RATE_LIMIT || "false");
const DEBUG_LOG = (/^(true|1)$/i).test(__ENV.DEBUG_LOG || "false");

// Metrics
const campaignInfo_duration = new Trend("campaignInfo_duration");
const status_400 = new Counter("status_400");
const status_401 = new Counter("status_401");
const status_429 = new Counter("status_429");
const unexpected_error = new Counter("unexpected_error");
const transport_error = new Counter("transport_error");

// Scenario toggles and tunables (env-overridable) - aligned with Reward "Pizza" style
const ENABLE_WARMUP = (__ENV.ENABLE_WARMUP ?? "true").toLowerCase() === "true";
const ENABLE_SPIKE = (__ENV.ENABLE_SPIKE ?? "true").toLowerCase() === "true";
const ENABLE_RECOVERY = (__ENV.ENABLE_RECOVERY ?? "true").toLowerCase() === "true";
const ENABLE_DISCOVER = (__ENV.ENABLE_DISCOVER ?? "true").toLowerCase() === "true";

const WARMUP_RATE = Number(__ENV.WARMUP_RATE ?? 20);
const WARMUP_DURATION_S = String(__ENV.WARMUP_DURATION_S ?? 15);
const WARMUP_PREALLOC_VUS = Number(__ENV.WARMUP_PREALLOC_VUS ?? 60);
const WARMUP_MAX_VUS = Number(__ENV.WARMUP_MAX_VUS ?? 200);

const SPIKE_RATE = Number(__ENV.SPIKE_RATE ?? 60);
const SPIKE_DURATION_S = String(__ENV.SPIKE_DURATION_S ?? 15);
const SPIKE_PREALLOC_VUS = Number(__ENV.SPIKE_PREALLOC_VUS ?? 120);
const SPIKE_MAX_VUS = Number(__ENV.SPIKE_MAX_VUS ?? 400);

const RECOVERY_RATE = Number(__ENV.RECOVERY_RATE ?? 20);
const RECOVERY_DURATION_S = String(__ENV.RECOVERY_DURATION_S ?? 20);
const RECOVERY_PREALLOC_VUS = Number(__ENV.RECOVERY_PREALLOC_VUS ?? 60);
const RECOVERY_MAX_VUS = Number(__ENV.RECOVERY_MAX_VUS ?? 200);

// Discover/limit params - set DISCOVER_RATE * DISCOVER_DURATION_S to hit target requests (e.g., 200*150=30,000)
const DISCOVER_RATE = Number(__ENV.DISCOVER_RATE ?? 100);
const DISCOVER_DURATION_S = String(__ENV.DISCOVER_DURATION_S ?? 150);
const DISCOVER_PREALLOC_VUS = Number(__ENV.DISCOVER_PREALLOC_VUS ?? 300);
const DISCOVER_MAX_VUS = Number(__ENV.DISCOVER_MAX_VUS ?? 600);

// Optional scenario start offsets
const WARMUP_START = String(__ENV.WARMUP_START ?? "0s");
const SPIKE_START = String(__ENV.SPIKE_START ?? "15s");
const RECOVERY_START = String(__ENV.RECOVERY_START ?? "30s");
const DISCOVER_START = String(__ENV.DISCOVER_START ?? "50s");

// Options
export const options = {
  scenarios: (function buildScenarios() {
    const scenarios = {};
    if (ENABLE_WARMUP) {
      scenarios.warmup = {
        executor: "constant-arrival-rate",
        rate: WARMUP_RATE,
        timeUnit: "1s",
        duration: `${WARMUP_DURATION_S}s`.replace(/ss$/, "s"),
        preAllocatedVUs: WARMUP_PREALLOC_VUS,
        maxVUs: WARMUP_MAX_VUS,
        startTime: WARMUP_START,
        tags: { scenario: "warmup", endpoint: "campaignInfo" },
      };
    }
    if (ENABLE_SPIKE) {
      scenarios.spike = {
        executor: "constant-arrival-rate",
        rate: SPIKE_RATE,
        timeUnit: "1s",
        duration: `${SPIKE_DURATION_S}s`.replace(/ss$/, "s"),
        preAllocatedVUs: SPIKE_PREALLOC_VUS,
        maxVUs: SPIKE_MAX_VUS,
        startTime: SPIKE_START,
        tags: { scenario: "spike", endpoint: "campaignInfo" },
      };
    }
    if (ENABLE_RECOVERY) {
      scenarios.recovery = {
        executor: "constant-arrival-rate",
        rate: RECOVERY_RATE,
        timeUnit: "1s",
        duration: `${RECOVERY_DURATION_S}s`.replace(/ss$/, "s"),
        preAllocatedVUs: RECOVERY_PREALLOC_VUS,
        maxVUs: RECOVERY_MAX_VUS,
        startTime: RECOVERY_START,
        tags: { scenario: "recovery", endpoint: "campaignInfo" },
      };
    }
    if (ENABLE_DISCOVER) {
      scenarios.discover_limit = {
        executor: "constant-arrival-rate",
        rate: DISCOVER_RATE,
        timeUnit: "1s",
        duration: `${DISCOVER_DURATION_S}s`.replace(/ss$/, "s"),
        preAllocatedVUs: DISCOVER_PREALLOC_VUS,
        maxVUs: DISCOVER_MAX_VUS,
        startTime: DISCOVER_START,
        tags: { scenario: "discover_limit", endpoint: "campaignInfo" },
      };
    }
    return scenarios;
  })(),
  thresholds: {
    http_req_duration: ["p(95)<2000"],
    http_req_failed: ["rate<0.1"],
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
  const url =
    `${BASE_URL}${CAMPAIGN_INFO_ENDPOINT}` +
    `?utmCampaign=${encodeURIComponent(UTM_CAMPAIGN)}` +
    `&utmSource=${encodeURIComponent(UTM_SOURCE)}` +
    `&utmMedium=${encodeURIComponent(UTM_MEDIUM)}`;

  const tags = { endpoint: "campaignInfo", scenario: exec.scenario.name };

  if (__ENV.DEBUG_LOG && (getCampaignInfo._printed = (getCampaignInfo._printed || 0) + 1) <= 3) {
    console.log(`REQ URL -> ${url}`);
  }

  const res = http.get(url, {
    headers: buildHeaders(),  
    tags,                     
    timeout: "60s",
  });

 
  campaignInfo_duration.add(res.timings.duration, tags);

  if (res.status === 0) {
    // Transport-level failure (e.g., too many open files / DNS / socket)
    transport_error.add(1, tags);
  } else {
    if (res.status === 400) status_400.add(1, tags);
    if (res.status === 401) status_401.add(1, tags);
    if (res.status === 429) status_429.add(1, tags);
    if (res.status >= 500 || (res.status !== 200 && ![400, 401, 429].includes(res.status))) {
      unexpected_error.add(1, tags);
    }
  }

  //check
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

  // log error body
  if (res.status === 400 || res.status === 429) {
    let body;
    try { body = JSON.stringify(res.json()); } catch { body = res.body; }
    console.error(`BODY[${tags.scenario}][status=${res.status}] ${body}`);
    
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

// Default VU function
export default function () {
  getCampaignInfo();
}

//  Summary (HTML + JSON)
export function handleSummary(data) {
  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
    <title>🎯 Campaign Info Spike Test Results</title>
    <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin: 0; padding: 20px; background: linear-gradient(135deg, #36d1dc 0%, #5b86e5 100%); min-height: 100vh; }
        .container { max-width: 1200px; margin: 0 auto; background: white; border-radius: 15px; box-shadow: 0 20px 40px rgba(0,0,0,0.1); overflow: hidden; }
        .header { background: linear-gradient(135deg, #11998e, #38ef7d); color: white; padding: 30px; text-align: center; }
        .header h1 { margin: 0; font-size: 2.2em; font-weight: 300; }
        .content { padding: 30px; }
        .metric-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px; }
        .metric-card { background: #f8f9fa; border-radius: 10px; padding: 20px; border-left: 5px solid #17a2b8; }
        .metric-card h3 { margin: 0 0 10px 0; }
        .metric-value { font-size: 1.8em; font-weight: bold; color: #007bff; }
        table { width: 100%; border-collapse: collapse; margin: 20px 0; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        th, td { padding: 12px 15px; text-align: left; border-bottom: 1px solid #dee2e6; }
        th { background: #f8f9fa; font-weight: 600; color: #495057; }
        .status-success { color: #28a745; background: #d4edda; padding: 5px 10px; border-radius: 20px; font-weight: bold; }
        .status-danger { color: #721c24; background: #f8d7da; padding: 5px 10px; border-radius: 20px; font-weight: bold; }
    </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>📣 Campaign Info Spike Test</h1>
          <p>UTM: ${UTM_CAMPAIGN} | ${UTM_SOURCE} | ${UTM_MEDIUM}</p>
        </div>
        <div class="content">
          <div class="metric-grid">
            <div class="metric-card">
              <h3>Total Requests</h3>
              <div class="metric-value">${data.metrics.http_reqs?.values?.count || 0}</div>
            </div>
            <div class="metric-card">
              <h3>Success Rate</h3>
              <div class="metric-value">${(((data.metrics.http_reqs?.values?.count || 0) - (data.metrics.http_req_failed?.values?.count || 0)) / ((data.metrics.http_reqs?.values?.count || 0) + (data.metrics.transport_error?.values?.count || 0) || 1) * 100).toFixed(1)}%</div>
            </div>
            <div class="metric-card">
              <h3>Avg Response</h3>
              <div class="metric-value">${(data.metrics.http_req_duration?.values?.avg || 0).toFixed(0)}ms</div>
            </div>
            <div class="metric-card">
              <h3>P95</h3>
              <div class="metric-value">${(data.metrics.http_req_duration?.values?.['p(95)'] || 0).toFixed(0)}ms</div>
            </div>
          </div>

          <table>
            <thead><tr><th>Metric</th><th>Value</th></tr></thead>
            <tbody>
              <tr><td>200 OK</td><td>${(data.metrics.http_reqs?.values?.count || 0) - (data.metrics.http_req_failed?.values?.count || 0)}</td></tr>
              <tr><td>Failed</td><td>${data.metrics.http_req_failed?.values?.count || 0}</td></tr>
              <tr><td>Transport Errors</td><td>${data.metrics.transport_error?.values?.count || 0}</td></tr>
            </tbody>
          </table>

          <table>
            <thead><tr><th>Threshold</th><th>Status</th></tr></thead>
            <tbody>
              ${Object.entries(data.thresholds || {}).map(([k,v]) => `<tr><td>${k}</td><td>${v.ok ? '<span class="status-success">PASS</span>' : '<span class="status-danger">FAIL</span>'}</td></tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </body>
  </html>`;

  return {
    "reports/campaignInfo_summary.json": JSON.stringify(data, null, 2),
    "reports/campaignInfo_summary.html": htmlContent,
  };
}

