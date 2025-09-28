import http from 'k6/http';
import { sleep, check } from 'k6';
import { Counter, Rate } from 'k6/metrics';

// For printing the default k6 table and creating HTML:
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.2/index.js';
import { htmlReport } from 'https://raw.githubusercontent.com/benc-uk/k6-reporter/main/dist/bundle.js';

const BASE_URL     = __ENV.BASE_URL     || 'https://testnetapiv2.nobitex.ir';
const ACCESS_TOKEN = __ENV.ACCESS_TOKEN || '340d8cd1b7afcde2ca72050f9da6783cad0a1b60';
const AUTH_SCHEME  = (__ENV.AUTH_SCHEME || 'Token').toString();

// UTM parameters from curl command
const UTM_CAMPAIGN = __ENV.UTM_CAMPAIGN || 'multistep_payout:base:crypto_champions_2:public';
const UTM_SOURCE   = __ENV.UTM_SOURCE   || 'snapp';
const UTM_MEDIUM   = __ENV.UTM_MEDIUM   || 'banner';

const SPIKE_MAX_VUS = Number(__ENV.SPIKE_MAX_VUS || 20);
const RAMP_UP_S     = Number(__ENV.RAMP_UP_S     || 5);
const HOLD_S        = Number(__ENV.HOLD_S        || 10);
const RAMP_DOWN_S   = Number(__ENV.RAMP_DOWN_S   || 5);
const P95_MS        = Number(__ENV.P95_MS        || 500);

// Since we want to count 429 errors, we set the default to false:
const EXPECT_RATE_LIMIT = String(__ENV.EXPECT_RATE_LIMIT || 'false').toLowerCase() !== 'false';

// ---- metrics
const status_200 = new Counter('status_200');
const status_2xx = new Counter('status_2xx');
const status_3xx = new Counter('status_3xx');
const status_4xx = new Counter('status_4xx');
const status_401 = new Counter('status_401');
const status_429 = new Counter('status_429');
const status_5xx = new Counter('status_5xx');
const unexpected_error = new Rate('unexpected_error');

// ---- options
export const options = {
  scenarios: {
    warmup: {
      executor: 'constant-arrival-rate',
      rate: 20, timeUnit: '1s',
      duration: '15s',
      preAllocatedVUs: 50, maxVUs: 200,
      exec: 'campaignsList',
      startTime: '0s',
    },
    spike: {
      executor: 'constant-arrival-rate',
      rate: 60, timeUnit: '1s',
      duration: '15s',
      preAllocatedVUs: 150, maxVUs: 1000,
      exec: 'campaignsList',
      startTime: '15s',
    },
    recovery: {
      executor: 'constant-arrival-rate',
      rate: 20, timeUnit: '1s',
      duration: '20s',
      preAllocatedVUs: 50, maxVUs: 200,
      exec: 'campaignsList',
      startTime: '30s',
    },
  },
  thresholds: {
    'http_req_duration{endpoint:campaigns}': ['p(95)<500'],
    'checks{endpoint:campaigns,check:payload_ok}': ['rate>0.99'],
    'status_429': ['count==0'],
    'unexpected_error': ['rate==0'],
  },
};


// ---- helpers
function authHeaders() {
  return {
    headers: {
      Authorization: `${AUTH_SCHEME} ${ACCESS_TOKEN}`,
      Accept: 'application/json',
    },
    tags: { endpoint: 'campaigns' },
  };
}
function sleepJitter(minMs, maxMs) {
  const ms = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  sleep(ms / 1000);
}

// ---- main scenario
export function campaignsList() {
  // Build URL with UTM parameters (manually encoded to handle colons and special characters)
  const encodedCampaign = encodeURIComponent(UTM_CAMPAIGN);
  const encodedSource = encodeURIComponent(UTM_SOURCE);
  const encodedMedium = encodeURIComponent(UTM_MEDIUM);
  
  const url = `${BASE_URL}/marketing/campaign?utmCampaign=${encodedCampaign}&utmSource=${encodedSource}&utmMedium=${encodedMedium}`;
  const res = http.get(url, authHeaders());

  if (res.status >= 200 && res.status < 300) {
    status_2xx.add(1); if (res.status === 200) status_200.add(1);
    unexpected_error.add(0);
  } else if (res.status >= 300 && res.status < 400) {
    status_3xx.add(1); unexpected_error.add(1);
  } else if (res.status >= 400 && res.status < 500) {
    status_4xx.add(1);
    if (res.status === 401) { status_401.add(1); unexpected_error.add(1); }
    else if (res.status === 429) { status_429.add(1); unexpected_error.add(EXPECT_RATE_LIMIT ? 0 : 1); }
    else { unexpected_error.add(1); }
  } else if (res.status >= 500) {
    status_5xx.add(1); unexpected_error.add(1);
  } else {
    unexpected_error.add(1);
  }

  const ok200 = check(res, { 'HTTP 200': (r) => r.status === 200 }, { endpoint: 'campaigns', check: 'http200' });
  if (ok200) {
    const b = res.json();
    check(b, {
      'payload ok': (x) => x?.status === 'ok' && x?.details && Array.isArray(x?.details?.items),
    }, { endpoint: 'campaigns', check: 'payload_ok' });
  }

  sleepJitter(150, 400);
}

// Default VU function for CLI runs
export default function () {
  campaignsList();
}

//  summary: default k6 table + HTML file
export function handleSummary(data) {
  return {
    stdout: textSummary(data, { indent: ' ', enableColors: true }),
    'reports/campaignsList_summary.html': htmlReport(data),
    'reports/campaignsList_summary.json': JSON.stringify(data, null, 2),
  };
}
