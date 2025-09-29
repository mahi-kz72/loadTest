import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Counter, Rate, Gauge } from 'k6/metrics';
import exec from 'k6/execution';

// Reports
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.2/index.js';
import { htmlReport } from 'https://raw.githubusercontent.com/benc-uk/k6-reporter/main/dist/bundle.js';

// Config via env
const TEST_NAME      = (__ENV.TEST_NAME || 'generic').toString();
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
    [`http_req_duration{endpoint:${TEST_NAME}}`]: [`p(95)<${P95_SLA_MS}`],
  },
};

function headers() {
  const h = {
    Accept: 'application/json',
    'Content-Type': CONTENT_TYPE,
    Authorization: `${AUTH_SCHEME} ${ACCESS_TOKEN}`,
  };
  return { headers: h, tags: { endpoint: TEST_NAME } };
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
    check(body, { [`payload ok (${TEST_NAME})`]: (b) => !b || b.status === 'ok' }, { endpoint: TEST_NAME, check: 'payload_ok' });
  }

  sleep(0.05);
}

// Default VU function so CLI runs without custom scenarios
export default function () {
  breakpointProbe();
}

// Summary report files per TEST_NAME
export function handleSummary(data) {
  const htmlName = `reports/breakpoint_${TEST_NAME}_summary.html`;
  const jsonName = `reports/breakpoint_${TEST_NAME}_summary.json`;
  return {
    stdout: textSummary(data, { indent: ' ', enableColors: true }),
    [htmlName]: htmlReport(data),
    [jsonName]: JSON.stringify(data, null, 2),
  };
}


