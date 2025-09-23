// spike/campaignsList_spike_test.js

import http from 'k6/http';
import { sleep, check } from 'k6';
import { Counter, Rate } from 'k6/metrics';

// برای چاپ جدول پیش‌فرض k6 و ساخت HTML:
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.2/index.js';
import { htmlReport } from 'https://raw.githubusercontent.com/benc-uk/k6-reporter/main/dist/bundle.js';

const BASE_URL     = __ENV.BASE_URL     || 'https://testnetapiv2.nobitex.ir';
const ACCESS_TOKEN = __ENV.ACCESS_TOKEN || '';
const AUTH_SCHEME  = (__ENV.AUTH_SCHEME || 'Token').toString();

const SPIKE_MAX_VUS = Number(__ENV.SPIKE_MAX_VUS || 20);
const RAMP_UP_S     = Number(__ENV.RAMP_UP_S     || 5);
const HOLD_S        = Number(__ENV.HOLD_S        || 10);
const RAMP_DOWN_S   = Number(__ENV.RAMP_DOWN_S   || 5);
const P95_MS        = Number(__ENV.P95_MS        || 500);

// چون می‌خوای 429 خطا حساب شود، پیش‌فرض را false می‌گذاریم:
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
    spike: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: `${RAMP_UP_S}s`,   target: SPIKE_MAX_VUS },
        { duration: `${HOLD_S}s`,      target: SPIKE_MAX_VUS },
        { duration: `${RAMP_DOWN_S}s`, target: 0 },
      ],
      gracefulStop: '30s',
      gracefulRampDown: '30s',
      exec: 'campaignsList',
    },
  },
  thresholds: {
    'http_req_duration{endpoint:campaigns}': [`p(95)<${P95_MS}`],
    'unexpected_error': ['rate==0'],  // هر خطای غیرمنتظره = fail
    'status_429': ['count==0'],       // هر 429 = fail (سخت‌گیرانه)
    'checks{endpoint:campaigns,check:payload_ok}': ['rate>0.99'],
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
  const res = http.get(`${BASE_URL}/marketing/campaigns`, authHeaders());

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
      'payload ok': (x) => x?.status === 'ok' && Array.isArray(x?.campaigns) && Array.isArray(x?.publicCampaigns),
    }, { endpoint: 'campaigns', check: 'payload_ok' });
  }

  sleepJitter(150, 400);
}

// ---- summary: جدول پیش‌فرض k6 + فایل HTML
export function handleSummary(data) {
  return {
    stdout: textSummary(data, { indent: ' ', enableColors: true }),
    'summary.html': htmlReport(data),
    'summary.json': JSON.stringify(data, null, 2),
  };
}
