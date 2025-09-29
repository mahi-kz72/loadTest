import * as bp from './discover_breakpoint_test.js';

export const options = {
  ...bp.options,
  scenarios: {
    ...bp.options.scenarios,
    discover_breakpoint: {
      ...bp.options.scenarios.discover_breakpoint,
      exec: 'default',
    },
  },
};

export default function () {
  // Override env at runtime for clarity
  __ENV.TEST_NAME = __ENV.TEST_NAME || 'campaign';
  __ENV.METHOD = __ENV.METHOD || 'GET';
  __ENV.ENDPOINT = __ENV.ENDPOINT || '/marketing/campaign';
  __ENV.QUERY = __ENV.QUERY || 'utmCampaign=multistep_payout:base:crypto_champions_2:public&utmSource=snapp&utmMedium=banner';
  bp.default();
}

export function handleSummary(data) { return bp.handleSummary(data); }

