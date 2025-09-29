# Load Testing (k6) for Marketing Service

## Overview

This repository contains k6 spike tests for three marketing endpoints:
- campaigns list: GET `/marketing/campaigns`
- campaign info: GET `/marketing/campaign`
- reward capacity: GET `/marketing/campaign/reward/capacity`

Each test writes individual summary reports to the `reports/` directory with API-specific names.

---

## Prerequisites
- A system-installed k6 (see `https://k6.io/docs/getting-started/installation/`)
- A valid `ACCESS_TOKEN` (auth scheme can be `Token`)

If your shell shows `command not found: k6`, run the bundled binary directly (via `./k6` symlink or absolute path) or add it to your PATH for the session.

---

## Environment Configuration
A sample env file is provided at `env.example`. Key variables:

- BASE_URL: default `https://testnetapiv2.nobitex.ir`
- ACCESS_TOKEN: auth token value
- AUTH_SCHEME: `Token` (default) for `Authorization` header
- SPIKE_MAX_VUS, RAMP_UP_S, HOLD_S, RAMP_DOWN_S: traffic shaping
- P95_MS: p95 latency threshold (ms)


```bash
export $(grep -v '^#' env.example | xargs)
```

---

## Running the Spike Tests

All commands below work with either `k6` on your PATH or the absolute binary path:
`/Users/apple/Downloads/loadTest/k6-v1.2.3-macos-arm64/k6`.

Quick run (matches local usage):

```bash
./k6 run \
  -e BASE_URL=https://testnetapiv2.nobitex.ir \
  -e ACCESS_TOKEN='ACTUAL_TOKEN_HERE' \
  -e UTM_CAMPAIGN='multistep_payout:base:crypto_champions:public' \
  -e UTM_SOURCE='snapp' \
  -e UTM_MEDIUM='banner' \
  -e EXPECT_RATE_LIMIT=false \
  -e DEBUG_LOG=false \
  spike/campaignInfo_spike_test.js
```

1) campaigns list

```bash
k6 run /Users/apple/Downloads/loadTest/spike/campaignsList_spike_test.js \
  -e BASE_URL="$BASE_URL" \
  -e ACCESS_TOKEN="$ACCESS_TOKEN" \
  -e AUTH_SCHEME="${AUTH_SCHEME:-Token}"
```

2) campaign info

```bash
k6 run /Users/apple/Downloads/loadTest/spike/campaignInfo_spike_test.js \
  -e BASE_URL="$BASE_URL" \
  -e ACCESS_TOKEN="$ACCESS_TOKEN" \
  -e UTM_CAMPAIGN="${UTM_CAMPAIGN:-multistep_payout:base:crypto_champions:public}" \
  -e UTM_SOURCE="${UTM_SOURCE:-snapp}" \
  -e UTM_MEDIUM="${UTM_MEDIUM:-banner}"
```

Note: `campaignInfo_spike_test.js` now honors `AUTH_SCHEME` via env; set to `Bearer` if needed.

3) reward capacity

```bash
k6 run /Users/apple/Downloads/loadTest/spike/rewardCapacity_spike_test.js \
  -e BASE_URL="$BASE_URL" \
  -e ACCESS_TOKEN="$ACCESS_TOKEN" \
  -e AUTH_SCHEME="${AUTH_SCHEME:-Token}"
```

Note: UTM parameters in this script are also configurable via env.

Outputs: Individual reports are generated in the `reports/` directory:
- `reports/campaignsList_summary.html` and `reports/campaignsList_summary.json`
- `reports/campaignInfo_summary.html` and `reports/campaignInfo_summary.json`
- `reports/rewardCapacity_summary.html` and `reports/rewardCapacity_summary.json`

### Breakpoint Discovery Test (generic)

Use the generic breakpoint test to find the capacity breakpoint per API using a ramped arrival-rate and thresholds on p95 latency and error rate. Reports are generated like the other tests.

Run example (campaign endpoint):
```bash
./k6 run spike/breakpoint_test.js --duration 20s \
  -e TEST_NAME=campaign \
  -e ENDPOINT=/marketing/campaign \
  -e QUERY='utmCampaign=multistep_payout:base:crypto_champions_2:public&utmSource=snapp&utmMedium=banner'
```

Key env vars:
- `TEST_NAME`           logical name for report files and metric tags
- `METHOD`              GET (default), POST, PUT, PATCH, DELETE
- `ENDPOINT`            API path, e.g. `/marketing/campaign`
- `QUERY`               raw query string (will be URI-encoded)
- `PAYLOAD`, `CONTENT_TYPE` for non-GET methods
- Thresholds: `P95_SLA_MS` (default 500), `ERROR_RATE_MAX` (default 0.01)
- Ramp schedule: `RAMP_START`, `RAMP_PEAK`, `RAMP_STEPS`, `STEP_SECONDS`

Reports:
- `reports/breakpoint_<TEST_NAME>_summary.html`
- `reports/breakpoint_<TEST_NAME>_summary.json`

### Quick Run All Tests
To run all tests at once and generate all reports:
```bash
./run_all_tests.sh
```

---

## Folder Structure
```
/loadTest
│
├── spike/
│   ├── campaignInfo_spike_test.js
│   ├── campaignsList_spike_test.js
│   ├── breakpoint_test.js
│   └── rewardCapacity_spike_test.js
│
├── reports/
│   ├── campaignsList_summary.html
│   ├── campaignsList_summary.json
│   ├── campaignInfo_summary.html
│   ├── campaignInfo_summary.json
│   ├── rewardCapacity_summary.html
│   ├── rewardCapacity_summary.json
│   ├── breakpoint_campaign_summary.html
│   └── breakpoint_campaign_summary.json
│
├── env.example
├── k6-v1.2.3-macos-arm64/
├── k6-v1.2.3-macos-arm64.zip
├── run_all_tests.sh
└── README.md
```


## Improvements (for future PR)
- Add CI job to run a small smoke (e.g., 1 VU, 3 iterations) on PRs.
- Consider centralizing shared helpers (headers, jitter, summary) in a module.

---

## Notes
- Set `ACCESS_TOKEN` for endpoints requiring auth.
- If 429 rate limiting is expected, adjust thresholds accordingly.
- Use the HTML/JSON reports in the `reports/` directory to monitor p95, status distribution, and error rates for each API.
