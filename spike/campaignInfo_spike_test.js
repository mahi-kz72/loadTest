import http from "k6/http";
import { check, sleep } from "k6";
import { Trend, Counter } from "k6/metrics";
import exec from "k6/execution";
import { htmlReport } from "https://jslib.k6.io/k6-summary/0.0.4/index.js";

// Env & Config 
const BASE_URL = __ENV.BASE_URL || "https://testnetapiv2.nobitex.ir";
const ACCESS_TOKEN = String(__ENV.ACCESS_TOKEN || "").trim();
const AUTH_SCHEME = (String(__ENV.AUTH_SCHEME || "Token")).trim();
const UTM_CAMPAIGN = __ENV.UTM_CAMPAIGN || "multistep_payout:base:crypto_champions:public";
const UTM_SOURCE = __ENV.UTM_SOURCE || "snapp";
const UTM_MEDIUM = __ENV.UTM_MEDIUM || "banner";

const EXPECT_RATE_LIMIT = (/^(true|1)$/i).test(__ENV.EXPECT_RATE_LIMIT || "false");
const DEBUG_LOG = (/^(true|1)$/i).test(__ENV.DEBUG_LOG || "false");

// Custom Metrics (valid names)
const campaignInfo_duration = new Trend("campaignInfo_duration");
const status_400 = new Counter("status_400");
const status_401 = new Counter("status_401");
const status_429 = new Counter("status_429");
const unexpected_error = new Counter("unexpected_error");

// Options: scenarios & thresholds
export const options = {
  scenarios: {
    // 1) Warmup: 20 rps for 15s
    warmup: {
      executor: "constant-arrival-rate",
      rate: 20,
      timeUnit: "1s",
      duration: "15s",
      preAllocatedVUs: 20,
      maxVUs: 100,
    },
    // 2) Spike: 60 rps for 15s
    spike: {
      executor: "constant-arrival-rate",
      startTime: "15s",
      rate: 60,
      timeUnit: "1s",
      duration: "15s",
      preAllocatedVUs: 40,
      maxVUs: 150,
    },
    // 3) Recovery: 20 rps for 20s
    recovery: {
      executor: "constant-arrival-rate",
      startTime: "30s",
      rate: 20,
      timeUnit: "1s",
      duration: "20s",
      preAllocatedVUs: 20,
      maxVUs: 100,
    },
    // 4) Discover Limit: ramp RPS to find rate-limit (optional; comment if not needed)
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
    // Latency per endpoint (global)
    "http_req_duration{endpoint:campaignInfo}": ["p(95)<500", "p(99)<1000"],
    // Tighter latency for spike window
    "http_req_duration{endpoint:campaignInfo,scenario:spike}": ["p(95)<350"],

    // Errors (custom counters). 429 is not allowed in main scenarios
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
  const headers = {
    "Content-Type": "application/json",
    // هر Header دیگری که بخوای اینجا
  };
  if (ACCESS_TOKEN) {
    headers["Authorization"] = `${AUTH_SCHEME} ${ACCESS_TOKEN}`;
  }
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
    console.log(
      `INFO [${label}][${res.status}] RL-Rem=${rlRem} Body=${res.body}`
    );
  } else {
    console.log(`INFO [${label}][${res.status}] RL-Rem=${rlRem}`);
  }
}

// Test Step 
function getCampaignInfo() {
  const url =
    `${BASE_URL}/marketing/campaign` +
    `?utmCampaign=${encodeURIComponent(UTM_CAMPAIGN)}` +
    `&utmSource=${encodeURIComponent(UTM_SOURCE)}` +
    `&utmMedium=${encodeURIComponent(UTM_MEDIUM)}`;

  const tags = { endpoint: "campaignInfo", scenario: exec.scenario.name };

  const res = http.get(
    url,
    {
      headers: buildHeaders(),
      tags, // باعث میشه متریک‌های built-in هم تگ endpoint بگیرن
      timeout: "60s",
    }
  );

  
  campaignInfo_duration.add(res.timings.duration, tags);

  // Counters by status
  if (res.status === 400) status_400.add(1, tags);
  if (res.status === 401) status_401.add(1, tags);
  if (res.status === 429) status_429.add(1, tags);
  if (res.status >= 500 || (res.status !== 200 && ![400, 401, 429].includes(res.status))) {
    unexpected_error.add(1, tags);
  }

  // Checks
  const okStatus = check(res, {
    "HTTP 200": (r) => r.status === 200,
  });

  const okPayload = okStatus && check(res, {
    "payload ok": (r) => {
      try {
        const j = r.json();
        return j && j.status === "ok" && j.details && Array.isArray(j.details.items);
      } catch (_) {
        return false;
      }
    },
  });

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
  return {
    "summary.json": JSON.stringify(data, null, 2),
    "summary.html": htmlReport(data),
  };
}
