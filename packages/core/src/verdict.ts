import { isConcentrated, type PoolRead, type Reading } from "./types.js";
import { v3Impact, walkSwap } from "./math.js";

export interface ImpactQuote {
  pool: string;
  venue: PoolRead["venue"];
  side: "buy" | "sell";
  sizeUsd: number;
  slippageBps: number | null;
  /** Result is a lower bound: the size leaves the current v3 liquidity range. */
  lowerBound: boolean;
  feeBps: number;
  /** Initialized ticks the simulated trade crossed (exact tick-by-tick simulation). */
  ticksCrossed?: number;
  note?: string;
}

/** Constant-product (Aerodrome v2 volatile, 0.3% fee) cost of a USDC-denominated size. */
export function v2Impact(usdcReserve: number, tokenReserve: number, usd: number, side: "buy" | "sell", feeBps = 30) {
  const f = 1 - feeBps / 10_000;
  const spot = usdcReserve / tokenReserve;
  if (side === "buy") {
    const dy = usd * f;
    const out = (tokenReserve * dy) / (usdcReserve + dy);
    const exec = usd / out;
    return { slippageBps: ((exec - spot) / spot) * 1e4 };
  }
  const dx = (usd / spot) * f;
  const out = (usdcReserve * dx) / (tokenReserve + dx);
  const exec = out / (usd / spot);
  return { slippageBps: ((spot - exec) / spot) * 1e4 };
}

/** Read-only price-impact quote against the pool a reading was based on. Never builds a transaction. */
export function quoteImpact(pool: PoolRead, tokenDecimals: number, usd: number, side: "buy" | "sell"): ImpactQuote {
  if (isConcentrated(pool.venue) && pool.ticks && pool.tickWindowBps && pool.liquidity != null && pool.sqrtPriceX96 != null && pool.tick != null && pool.tokenIsToken0 != null) {
    // Exact fee-aware simulation across the initialized ticks that were read on-chain.
    const w = walkSwap({
      sqrtPriceX96: BigInt(pool.sqrtPriceX96),
      liquidity: BigInt(pool.liquidity),
      tick: pool.tick,
      ticks: pool.ticks.map((t) => ({ tick: t.tick, liquidityNet: BigInt(t.liquidityNet) })),
      windowBps: pool.tickWindowBps,
      tokenIsToken0: pool.tokenIsToken0,
      tokenDecimals,
      feeBps: pool.feeBps ?? 0,
      side,
      usdBudget: usd,
    });
    if (!w) return { pool: pool.pool, venue: pool.venue, side, sizeUsd: usd, slippageBps: null, lowerBound: false, feeBps: pool.feeBps ?? 0, note: "cannot price this size" };
    return {
      pool: pool.pool,
      venue: pool.venue,
      side,
      sizeUsd: usd,
      slippageBps: Number.isFinite(w.slippageBps) ? w.slippageBps : null,
      lowerBound: w.windowExceeded,
      feeBps: pool.feeBps ?? 0,
      ticksCrossed: w.ticksCrossed,
    };
  }
  if (isConcentrated(pool.venue)) {
    if (pool.liquidity == null || pool.sqrtPriceX96 == null || pool.tick == null || pool.tickSpacing == null || pool.tokenIsToken0 == null) {
      return { pool: pool.pool, venue: pool.venue, side, sizeUsd: usd, slippageBps: null, lowerBound: false, feeBps: pool.feeBps ?? 0, note: "pool state incomplete" };
    }
    const r = v3Impact({
      sqrtPriceX96: BigInt(pool.sqrtPriceX96),
      liquidity: BigInt(pool.liquidity),
      tick: pool.tick,
      tickSpacing: pool.tickSpacing,
      tickLower: pool.tickLower,
      tickUpper: pool.tickUpper,
      tokenIsToken0: pool.tokenIsToken0,
      tokenDecimals,
      feeBps: pool.feeBps ?? 0, // basis points (chain.ts stores fee tier / 100)
      usdc: usd,
      side,
    });
    if (!r) return { pool: pool.pool, venue: pool.venue, side, sizeUsd: usd, slippageBps: null, lowerBound: false, feeBps: pool.feeBps ?? 0, note: "no in-range liquidity" };
    return { pool: pool.pool, venue: pool.venue, side, sizeUsd: usd, slippageBps: r.slippageBps, lowerBound: r.exceedsRange, feeBps: pool.feeBps ?? 0 };
  }
  const tokReserve = pool.usdcDepth / pool.spotPrice;
  const r = v2Impact(pool.usdcDepth, tokReserve, usd, side);
  return { pool: pool.pool, venue: pool.venue, side, sizeUsd: usd, slippageBps: r.slippageBps, lowerBound: false, feeBps: 30 };
}

export type VerdictLevel = "ok" | "caution" | "avoid" | "unknown";

export interface Verdict {
  verdict: VerdictLevel;
  reasons: string[];
  /** Always true: Assay never executes or prepares a trade. */
  readOnly: true;
  disclaimer: string;
}

export const DISCLAIMER =
  "Information only. Not financial advice. Assay does not trade, hold funds or endorse any token, venue or issuer, and is not endorsed by Base or token issuers.";

/**
 * Verdict for a hypothetical trade. Only describes how reliable the price check is
 * and what the size would cost in the pool: it never executes or builds a trade.
 */
export function verdictFor(reading: Reading | undefined, quote: ImpactQuote | undefined, ageSec: number, maxAgeSec = 900): Verdict {
  const v = (verdict: VerdictLevel, reasons: string[]): Verdict => ({ verdict, reasons, readOnly: true, disclaimer: DISCLAIMER });
  if (!reading) return v("unknown", ["token is not tracked"]);
  if (reading.status !== "ok") return v("unknown", [reading.unavailableReason ?? "no usable reading"]);
  if (ageSec > maxAgeSec) return v("unknown", [`latest Assay reading is ${Math.round(ageSec / 60)} min old`]);
  const reasons = [...reading.reasons];
  let level: VerdictLevel = "ok";
  const up = (l: VerdictLevel) => {
    const order = { ok: 0, caution: 1, avoid: 2, unknown: 3 } as const;
    if (order[l] > order[level]) level = l;
  };
  if (reading.state === "Broken") up("avoid");
  if (reading.state === "Stale" || reading.state === "Drifting") up("caution");
  if (quote) {
    if (quote.slippageBps == null) {
      up("avoid");
      reasons.push(quote.note ?? "cannot price this size");
    } else {
      const bpsTxt = `${quote.slippageBps.toFixed(0)} bps${quote.lowerBound ? " (at least: size exceeds current liquidity range)" : ""}`;
      if (quote.slippageBps > 300 || quote.lowerBound) up("avoid");
      else if (quote.slippageBps > 100) up("caution");
      reasons.push(`a $${quote.sizeUsd} ${quote.side} costs about ${bpsTxt} in the deepest pool`);
    }
  }
  return v(level, reasons);
}
