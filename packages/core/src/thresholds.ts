/**
 * Documented thresholds. Every one of these is a judgement call, chosen from
 * what live Base data looked like on 2026-11-09 (see docs/data-sources.md).
 */
export const THRESHOLDS = {
  /** Reference older than this is Stale. Chainlink heartbeat is 24h; 2h margin. Weekends and holidays exceed this by design. */
  maxReferenceAgeSec: 26 * 3600,
  /** |dex - reference| above this (basis points) is Drifting. */
  driftBps: 100,
  /** |dex - reference| above this is Broken. */
  brokenBps: 500,
  /** Pool USDC balance below this is too thin to trust. */
  minDepthUsd: 1000,
  /** A pool whose price can be pushed 1% for less than this many USD is too cheap to manipulate to be trusted. */
  minCostToMove100bpsUsd: 100,
  /** Spot vs 30 min TWAP divergence above this suggests manipulation: Broken. */
  twapDivergenceBps: 300,
  /** Two qualifying pools disagreeing by more than this: Broken. */
  poolDisagreementBps: 300,
  twapWindowSec: 1800,
} as const;
