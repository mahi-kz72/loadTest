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
  __ENV.TEST_NAME = __ENV.TEST_NAME || 'rewardCapacity';
  __ENV.METHOD = __ENV.METHOD || 'GET';
  __ENV.ENDPOINT = __ENV.ENDPOINT || '/marketing/campaign/reward/capacity';
  __ENV.QUERY = __ENV.QUERY || '';
  bp.default();
}

export function handleSummary(data) { return bp.handleSummary(data); }

