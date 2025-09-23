# Load Testing (k6) for Marketing Service

## Overview

This repository contains k6 spike tests for three marketing endpoints:
- campaigns list: GET `/marketing/campaigns`
- campaign info: GET `/marketing/campaign`
- reward capacity: GET `/marketing/campaign/reward/capacity`

Each test writes a summary report to `summary.html` and `summary.json` at the project root.

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



---

## Folder Structure
```
/loadTest
│
├── spike/
│   ├── campaignInfo_spike_test.js
│   ├── campaignsList_spike_test.js
│   └── rewardCapacity_spike_test.js
│
├── env.example
├── k6-v1.2.3-macos-arm64/
├── k6-v1.2.3-macos-arm64.zip
├── summary.html
├── summary.json
└── README.md
```


