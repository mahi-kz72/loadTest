import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Counter, Rate, Gauge } from 'k6/metrics';
import exec from 'k6/execution';

// Reports
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.2/index.js';
import { htmlReport } from 'https://raw.githubusercontent.com/benc-uk/k6-reporter/main/dist/bundle.js';

// Config via env (read TEST_NAME dynamically to allow wrapper overrides)
function getTestName() {
  return (__ENV.TEST_NAME || 'generic').toString();
}
const METHOD         = (__ENV.METHOD || 'GET').toUpperCase();
const BASE_URL       = __ENV.BASE_URL || 'https://testnetapiv2.nobitex.ir';
const ENDPOINT       = __ENV.ENDPOINT || '/marketing/campaign';
const QUERY          = __ENV.QUERY || 'utmCampaign=multistep_payout:base:crypto_champions_2:public&utmSource=snapp&utmMedium=banner';
const PAYLOAD        = __ENV.PAYLOAD || '';
const CONTENT_TYPE   = __ENV.CONTENT_TYPE || 'application/json';
const AUTH_SCHEME    = (__ENV.AUTH_SCHEME || 'Token').toString();
const ACCESS_TOKEN   = __ENV.ACCESS_TOKEN || '340d8cd1b7afcde2ca72050f9da6783cad0a1b60';

// Ramping schedule to locate breakpoint
// You can override with STAGE_x targets/durations if needed
const RAMP_START     = Number(__ENV.RAMP_START || 20);     // rps
const RAMP_PEAK      = Number(__ENV.RAMP_PEAK  || 240);    // rps
const RAMP_STEPS     = Number(__ENV.RAMP_STEPS || 4);
const STEP_SECONDS   = Number(__ENV.STEP_SECONDS || 30);

// Thresholds that define degradation/breakpoint
const P95_SLA_MS     = Number(__ENV.P95_SLA_MS || 500);
const ERROR_RATE_MAX = Number(__ENV.ERROR_RATE_MAX || 0.01); // 1%
const BREACH_CONSECUTIVE = Number(__ENV.BREACH_CONSECUTIVE || 30); // sustained breaches before early-stop

// Metrics
const bp_req_duration = new Trend(`bp_req_duration`, true);
const bp_error_rate   = new Rate('bp_error_rate');
const bp_http_2xx     = new Counter('bp_http_2xx');
const bp_http_4xx     = new Counter('bp_http_4xx');
const bp_http_5xx     = new Counter('bp_http_5xx');
const bp_status_401   = new Counter('bp_status_401');
const bp_status_429   = new Counter('bp_status_429');
const bp_breakpoint_rps = new Gauge('bp_breakpoint_rps');

// Build dynamic stages
function buildStages() {
  const stages = [];
  const step = Math.max(1, Math.floor((RAMP_PEAK - RAMP_START) / Math.max(1, RAMP_STEPS - 1)));
  let target = RAMP_START;
  for (let i = 0; i < RAMP_STEPS; i += 1) {
    stages.push({ target, duration: `${STEP_SECONDS}s` });
    target = Math.min(RAMP_PEAK, target + step);
  }
  return stages;
}

export const options = {
  scenarios: {
    discover_breakpoint: {
      executor: 'ramping-arrival-rate',
      startRate: RAMP_START,
      timeUnit: '1s',
      preAllocatedVUs: 100,
      maxVUs: 1000,
      stages: buildStages(),
      exec: 'breakpointProbe',
    },
  },
  thresholds: {
    'bp_error_rate': [`rate<=${ERROR_RATE_MAX}`],
    // Note: options are evaluated at import time; keep a stable tag here
    [`http_req_duration{endpoint:generic}`]: [`p(95)<${P95_SLA_MS}`],
  },
};

function headers() {
  const h = {
    Accept: 'application/json',
    'Content-Type': CONTENT_TYPE,
    Authorization: `${AUTH_SCHEME} ${ACCESS_TOKEN}`,
  };
  return { headers: h, tags: { endpoint: getTestName() } };
}

function buildUrl() {
  const q = QUERY ? `?${encodeURI(QUERY)}` : '';
  return `${BASE_URL}${ENDPOINT}${q}`;
}

export function breakpointProbe() {
  const url = buildUrl();
  let res;
  try {
    if (METHOD === 'POST') {
      res = http.post(url, PAYLOAD, headers());
    } else if (METHOD === 'PUT') {
      res = http.put(url, PAYLOAD, headers());
    } else if (METHOD === 'PATCH') {
      res = http.patch(url, PAYLOAD, headers());
    } else if (METHOD === 'DELETE') {
      res = http.del(url, null, headers());
    } else {
      res = http.get(url, headers());
    }
  } catch (e) {
    bp_error_rate.add(1);
    return;
  }

  // classify
  const status = res.status | 0;
  if (status >= 200 && status < 300) bp_http_2xx.add(1); else
  if (status >= 400 && status < 500) {
    bp_http_4xx.add(1);
    if (status === 401) bp_status_401.add(1);
    if (status === 429) bp_status_429.add(1);
    bp_error_rate.add(1);
  } else if (status >= 500) {
    bp_http_5xx.add(1);
    bp_error_rate.add(1);
  }

  bp_req_duration.add(res.timings.duration);

  // Lightweight payload sanity check (optional): status: ok
  if (status === 200) {
    const body = (function () { try { return res.json(); } catch (_) { return null; } })();
    const tn = getTestName();
    check(body, { [`payload ok (${tn})`]: (b) => !b || b.status === 'ok' }, { endpoint: tn, check: 'payload_ok' });
  }

  sleep(0.05);

  // Early-stop heuristic on sustained breaches (latency/errors)
  const rateLimitExpected = (String(__ENV.EXPECT_RATE_LIMIT || 'false').toLowerCase() !== 'false');
  const breached = (res.timings.duration > P95_SLA_MS) || (status >= 500) || (status === 429 && !rateLimitExpected);
  if (breached) {
    breakpointProbe._breachCount = (breakpointProbe._breachCount || 0) + 1;
    if (breakpointProbe._breachCount >= BREACH_CONSECUTIVE) {
      bp_breakpoint_rps.add(0); // marker (exact RPS not available here)
      exec.test.abort(`Breakpoint reached after ${BREACH_CONSECUTIVE} sustained breaches (latency/errors).`);
    }
  } else {
    breakpointProbe._breachCount = 0;
  }
}

// Default VU function so CLI runs without custom scenarios
export default function () {
  breakpointProbe();
}

// Summary report files per TEST_NAME
export function handleSummary(data) {
  const tn = getTestName();
  const htmlName = `reports/breakpoint_${tn}_summary.html`;
  const jsonName = `reports/breakpoint_${tn}_summary.json`;

  // Extract key metrics
  const m = data.metrics || {};
  const dur = (m['http_req_duration'] || {}).values || {};
  const p95 = dur['p(95)'];
  const avg = dur['avg'];
  const reqs = (m['http_reqs'] || {}).values || {};
  const totalReqs = reqs['count'];
  const erV = (m['bp_error_rate'] || {}).values || {};
  const er = erV['rate'];

  const header = `<!doctype html><html><head><meta charset="utf-8"><title>Breakpoint Report - ${tn}</title><style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;margin:16px;background:#f9fafb}.card{border:1px solid #e5e7eb;border-radius:8px;padding:12px;margin-bottom:16px;background:#fff}.k{color:#6b7280}.v{font-weight:600}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}</style></head><body><div class="card"><h2>Breakpoint Summary – ${tn}</h2><div class="grid"><div><span class="k">Avg duration:</span> <span class="v">${avg ? avg.toFixed(2) : 'n/a'} ms</span></div><div><span class="k">p95 duration:</span> <span class="v">${p95 ? p95.toFixed(2) : 'n/a'} ms</span></div><div><span class="k">Total requests:</span> <span class="v">${totalReqs ?? 'n/a'}</span></div><div><span class="k">Error rate:</span> <span class="v">${er != null ? (er * 100).toFixed(2) + '%' : 'n/a'}</span></div></div></div>`;
  const tail = `</body></html>`;
  const fullHtml = header + htmlReport(data) + tail;

  return {
    stdout: textSummary(data, { indent: ' ', enableColors: true }),
    [htmlName]: fullHtml,
    [jsonName]: JSON.stringify(data, null, 2),
  };
}


