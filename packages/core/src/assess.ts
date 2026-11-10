import { THRESHOLDS as T } from "./thresholds.js";
import { bps, deviationBps } from "./math.js";
import { isConcentrated, type PoolRead, type Reading, type State, type TokenRef } from "./types.js";

export interface PoolVerdict {
  ok: boolean;
  why?: string;
}

/** Depth/sanity guard: decides whether a pool's spot price may be used at all. */
export function vetPool(p: PoolRead): PoolVerdict {
  if (isConcentrated(p.venue) && (p.liquidity ?? 0n) === 0n) {
    return { ok: false, why: "zero in-range liquidity (spot price is meaningless)" };
  }
  if (!Number.isFinite(p.spotPrice) || p.spotPrice <= 0) return { ok: false, why: "non-finite price" };
  if (p.usdcDepth < T.minDepthUsd) {
    return { ok: false, why: `USDC depth $${p.usdcDepth.toFixed(2)} below $${T.minDepthUsd}` };
  }
  if (p.costToMove100bpsUsd != null && p.costToMove100bpsUsd < T.minCostToMove100bpsUsd) {
    return {
      ok: false,
      why: `only $${p.costToMove100bpsUsd.toFixed(0)} moves the price 1% (minimum $${T.minCostToMove100bpsUsd}): too cheap to manipulate`,
    };
  }
  return { ok: true };
}

export interface Classification {
  state: State;
  reasons: string[];
}

export function classify(i: {
  dexPrice: number;
  reference: number;
  referenceAgeSec: number;
  twapDivergenceBps?: number;
  poolDisagreementBps?: number;
  multiplierChanged?: boolean;
}): Classification {
  const dev = Math.abs(deviationBps(i.dexPrice, i.reference));
  if (i.multiplierChanged) {
    return { state: "Broken", reasons: ["multiplier changed since the last reading: corporate action in progress, comparison not valid"] };
  }
  if (i.referenceAgeSec > T.maxReferenceAgeSec) {
    return {
      state: "Stale",
      reasons: [`reference is ${(i.referenceAgeSec / 3600).toFixed(1)}h old (limit ${T.maxReferenceAgeSec / 3600}h): feed is frozen, off-hours or paused`],
    };
  }
  if ((i.twapDivergenceBps ?? 0) > T.twapDivergenceBps) {
    return {
      state: "Broken",
      reasons: [`spot differs from ${T.twapWindowSec / 60}m TWAP by ${i.twapDivergenceBps!.toFixed(0)} bps: possible manipulation`],
    };
  }
  if ((i.poolDisagreementBps ?? 0) > T.poolDisagreementBps) {
    return { state: "Broken", reasons: [`qualifying pools disagree by ${i.poolDisagreementBps!.toFixed(0)} bps`] };
  }
  if (dev > T.brokenBps) {
    return { state: "Broken", reasons: [`DEX price is ${dev.toFixed(0)} bps from reference (broken above ${T.brokenBps})`] };
  }
  if (dev > T.driftBps) {
    return { state: "Drifting", reasons: [`DEX price is ${dev.toFixed(0)} bps from reference (drifting above ${T.driftBps})`] };
  }
  return { state: "Fresh", reasons: [`within ${T.driftBps} bps of reference (${dev.toFixed(0)} bps)`] };
}

/** Build one reading from already-fetched inputs. Pure: no network. */
export function buildReading(opts: {
  token: TokenRef;
  pools: PoolRead[];
  now: Date;
  block?: string;
  previousMultiplier?: number;
  /** Reference override (e.g. a direct Chainlink read); defaults to token.navPrice. */
  reference?: { value: number; updatedAt: string };
}): Reading {
  const { token, pools, now } = opts;
  const poolsRejected: { pool: string; why: string }[] = [];
  const base = {
    symbol: token.symbol,
    address: token.address,
    multiplier: token.multiplier,
    reasons: [] as string[],
    poolsConsidered: pools.length,
    poolsRejected,
    readAt: now.toISOString(),
    block: opts.block,
  };
  const ref =
    opts.reference ??
    (token.navPrice != null && token.navUpdatedAt ? { value: token.navPrice, updatedAt: token.navUpdatedAt } : undefined);
  if (!ref) {
    return { ...base, status: "unavailable", unavailableCode: "no-reference", unavailableReason: "no reference value published for this token" };
  }

  const good: PoolRead[] = [];
  for (const p of pools) {
    const v = vetPool(p);
    if (v.ok) good.push(p);
    else poolsRejected.push({ pool: p.pool, why: v.why! });
  }
  const refAge = (now.getTime() - Date.parse(ref.updatedAt)) / 1000;
  const common = {
    reference: ref.value,
    referenceUpdatedAt: ref.updatedAt,
    referenceAgeSec: refAge,
    underlyingPrice: ref.value / token.multiplier,
  };
  if (good.length === 0) {
    return {
      ...base,
      ...common,
      status: "unavailable",
      unavailableCode: pools.length ? "pool-too-thin" : "no-pool",
      unavailableReason: pools.length
        ? "pools exist but none is deep enough to trust (see the rejected pools)"
        : "No pool on Base yet: no USDC pool was found on any DEX Assay reads",
    };
  }
  good.sort((a, b) => b.usdcDepth - a.usdcDepth);
  const used = good[0]!;
  const dex = used.spotPrice;
  const twapDiv = used.twapPrice ? bps(dex, used.twapPrice) : undefined;
  const disagree = good.length > 1 ? Math.max(...good.slice(1).map((p) => bps(p.spotPrice, dex))) : undefined;
  const c = classify({
    dexPrice: dex,
    reference: ref.value,
    referenceAgeSec: refAge,
    twapDivergenceBps: twapDiv,
    poolDisagreementBps: disagree,
    multiplierChanged: opts.previousMultiplier != null && Math.abs(opts.previousMultiplier - token.multiplier) > 1e-12,
  });
  const reasons = [...c.reasons];
  if (used.twapPrice == null) {
    reasons.push(`no TWAP (${used.twapNote ?? "no oracle history"}): relying on depth and cross-pool agreement`);
  }
  return {
    ...base,
    ...common,
    status: "ok",
    state: c.state,
    reasons,
    dexPrice: dex,
    deviationBps: deviationBps(dex, ref.value),
    twapDivergenceBps: twapDiv,
    poolUsed: used,
  };
}
