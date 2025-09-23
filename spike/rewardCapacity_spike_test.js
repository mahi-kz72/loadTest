import http from 'k6/http';
import { sleep, check } from 'k6';
import { Counter, Rate } from 'k6/metrics';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.2/index.js';
import { htmlReport } from 'https://raw.githubusercontent.com/benc-uk/k6-reporter/main/dist/bundle.js';

const BASE_URL     = __ENV.BASE_URL     || 'https://testnetapiv2.nobitex.ir';
const ACCESS_TOKEN = __ENV.ACCESS_TOKEN || '';
const AUTH_SCHEME  = (__ENV.AUTH_SCHEME || 'Token').toString();
const UTM_CAMPAIGN = (__ENV.UTM_CAMPAIGN || 'wallet_payout:trade:crypto_ada:private').toString();
const UTM_SOURCE   = (__ENV.UTM_SOURCE   || 'snapp').toString();
const UTM_MEDIUM   = (__ENV.UTM_MEDIUM   || 'banner').toString();

const SPIKE_MAX_VUS = Number(__ENV.SPIKE_MAX_VUS || 20);
const RAMP_UP_S     = Number(__ENV.RAMP_UP_S     || 5);
const HOLD_S        = Number(__ENV.HOLD_S        || 10);
const RAMP_DOWN_S   = Number(__ENV.RAMP_DOWN_S   || 5);
const P95_MS        = Number(__ENV.P95_MS        || 500);

// Policies:
const EXPECT_RATE_LIMIT = String(__ENV.EXPECT_RATE_LIMIT || 'false').toLowerCase() !== 'false'; // 429 خطا؟ (پیش‌فرض: بله، خطا)
const EXPECT_409_OK     = String(__ENV.EXPECT_409_OK     || 'true').toLowerCase() === 'true';   // 409 مجاز؟ (پیش‌فرض: آره)

// ---- metrics
const status_200 = new Counter('status_200');
const status_2xx = new Counter('status_2xx');
const status_3xx = new Counter('status_3xx');
const status_4xx = new Counter('status_4xx');
const status_401 = new Counter('status_401');
const status_409 = new Counter('status_409');
const status_429 = new Counter('status_429');
const status_5xx = new Counter('status_5xx');
const unexpected_error = new Rate('unexpected_error');

export const options = {
  scenarios: {
    warmup: {
      executor: 'constant-arrival-rate',
      rate: 20, timeUnit: '1s',
      duration: '15s',
      preAllocatedVUs: 50, maxVUs: 200,
      exec: 'rewardCapacity',
      startTime: '0s',
    },
    spike: {
      executor: 'constant-arrival-rate',
      rate: 60, timeUnit: '1s',
      duration: '15s',
      preAllocatedVUs: 150, maxVUs: 1000,
      exec: 'rewardCapacity',
      startTime: '15s',
    },
    recovery: {
      executor: 'constant-arrival-rate',
      rate: 20, timeUnit: '1s',
      duration: '20s',
      preAllocatedVUs: 50, maxVUs: 200,
      exec: 'rewardCapacity',
      startTime: '30s',
    },
  },
  thresholds: {
    'http_req_duration{endpoint:rewardCapacity}': [`p(95)<${P95_MS}`],
    // We want two things to be zero: 429 and unexpected error
    'status_429': ['count==0'],
    'unexpected_error': ['rate==0']
  },
};

// ---- helpers
function authHeaders() {
  return {
    headers: {
      Authorization: `${AUTH_SCHEME} ${ACCESS_TOKEN}`,
      Accept: 'application/json',
    },
    tags: { endpoint: 'rewardCapacity' },
  };
}
function sleepJitter(minMs, maxMs) {
  const ms = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  sleep(ms / 1000);
}

// ---- scenario
export function rewardCapacity() {
  const url = `${BASE_URL}/marketing/campaign/reward/capacity` +
              `?utmCampaign=${encodeURIComponent(UTM_CAMPAIGN)}` +
              `&utmSource=${encodeURIComponent(UTM_SOURCE)}` +
              `&utmMedium=${encodeURIComponent(UTM_MEDIUM)}`;
  const res = http.get(url, authHeaders());

  if (res.status >= 200 && res.status < 300) {
    status_2xx.add(1); if (res.status === 200) status_200.add(1);
    unexpected_error.add(0);
  } else if (res.status === 409) {
    status_409.add(1);
    unexpected_error.add(EXPECT_409_OK ? 0 : 1);
  } else if (res.status === 429) {
    status_429.add(1);
    unexpected_error.add(EXPECT_RATE_LIMIT ? 0 : 1);
  } else if (res.status >= 400 && res.status < 500) {
    status_4xx.add(1);
    if (res.status === 401) status_401.add(1);
    unexpected_error.add(1);
  } else if (res.status >= 500) {
    status_5xx.add(1);
    unexpected_error.add(1);
  } else if (res.status >= 300 && res.status < 400) {
    status_3xx.add(1);
    unexpected_error.add(1);
  } else {
    unexpected_error.add(1);
  }

  // Check that respects 409:
  check(res, {
    'valid status': (r) => r.status === 200 || (EXPECT_409_OK && r.status === 409),
  }, { endpoint: 'rewardCapacity', check: 'valid_status' });

  sleepJitter(150, 400);
}

// ---- summary
export function handleSummary(data) {
  return {
    stdout: textSummary(data, { indent: ' ', enableColors: true }),
    'summary.html': htmlReport(data),
    'summary.json': JSON.stringify(data, null, 2),
  };
}
