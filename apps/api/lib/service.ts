import { isConcentrated, quoteImpact, verdictFor, DISCLAIMER, THRESHOLDS, type PoolRead, type Reading, type Verdict, type ImpactQuote } from "@assay/core";
import type { ActionEvent, HistoryPoint, LatestDoc, StateEvent, Store } from "./store.js";

/** Read-side service shared by the HTTP API and the MCP server. Nothing here can write chain state or trade. */

export const MAX_SIZE_USD = 1_000_000;

export function findReading(doc: LatestDoc | null, symbol: string): Reading | undefined {
  const s = symbol.trim().toLowerCase();
  const hit = doc?.readings.find((r) => r.symbol.toLowerCase() === s || r.symbol.toLowerCase() === s + "c");
  if (hit) return hit;
  // A real token that simply has no reference value: return an explained "unavailable" reading, not an error.
  const u = doc?.untrackedTokens?.find((t) => t.symbol.toLowerCase() === s || t.symbol.toLowerCase() === s + "c");
  if (u && doc) {
    return {
      symbol: u.symbol,
      address: "0x0000000000000000000000000000000000000000",
      status: "unavailable",
      unavailableCode: "no-reference",
      unavailableReason: "The Tokenized Stocks API publishes no reference value for this token, so it cannot be assayed.",
      reasons: [],
      multiplier: u.multiplier,
      poolsConsidered: 0,
      poolsRejected: [],
      readAt: doc.updatedAt,
    };
  }
  return undefined;
}

export const ageSec = (doc: LatestDoc | null, now = Date.now()) => (doc ? (now - Date.parse(doc.updatedAt)) / 1000 : Infinity);

export async function getLatest(store: Store): Promise<LatestDoc | null> {
  return store.get<LatestDoc>("latest");
}

export async function getHistory(store: Store, symbol: string, limit = 288): Promise<HistoryPoint[]> {
  return ((await store.get<HistoryPoint[]>(`history:${symbol}`)) ?? []).slice(-Math.min(Math.max(limit, 1), 2016));
}

export async function getActions(store: Store, symbol?: string): Promise<ActionEvent[]> {
  const all = (await store.get<ActionEvent[]>("actions")) ?? [];
  const f = symbol ? all.filter((a) => a.symbol.toLowerCase() === symbol.toLowerCase()) : all;
  return f.slice().reverse();
}

export async function getEvents(store: Store): Promise<StateEvent[]> {
  return ((await store.get<StateEvent[]>("events")) ?? []).slice().reverse();
}

export function parseSize(v: unknown): number | { error: string } {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n <= 0) return { error: "usd must be a positive number" };
  if (n > MAX_SIZE_USD) return { error: `usd must be at most ${MAX_SIZE_USD}` };
  return n;
}

export function parseSide(v: unknown): "buy" | "sell" | { error: string } {
  return v === "sell" ? "sell" : v === "buy" || v == null || v === "" ? "buy" : { error: "side must be buy or sell" };
}

/** Quote the cost of a size against the pool a reading is based on. Read-only estimate. */
export function probe(doc: LatestDoc | null, symbol: string, usd: number, side: "buy" | "sell") {
  const reading = findReading(doc, symbol);
  if (!reading) return { ok: false as const, status: "unknown" as const, error: `unknown symbol: ${symbol}` };
  if (reading.status !== "ok" || !reading.poolUsed) {
    // Explained state, returned with HTTP 200: the request was valid, there is just nothing to quote.
    return {
      ok: false as const,
      status: "unavailable" as const,
      code: reading.unavailableCode,
      error: reading.unavailableReason ?? "no usable pool",
      symbol: reading.symbol,
      rejectedPools: reading.poolsRejected,
    };
  }
  const pool = reading.poolUsed as PoolRead;
  const quote: ImpactQuote = quoteImpact(pool, 8, usd, side);
  return {
    ok: true as const,
    symbol: reading.symbol,
    readAt: reading.readAt,
    pool: { address: pool.pool, venue: pool.venue, feeBps: pool.feeBps, usdcDepth: pool.usdcDepth, spotPrice: pool.spotPrice },
    quote,
    label: quote.lowerBound ? "AT_LEAST" : "ESTIMATE",
    explanation: quote.lowerBound
      ? "At least: this size needs more liquidity than Assay read around the current price (about 3% each side), so the true cost is higher than shown."
      : "Estimate from a tick-by-tick simulation over the liquidity read on-chain, fee included.",
    method:
      isConcentrated(pool.venue)
        ? "Simulated tick by tick over the initialized ticks read on-chain (about 3% each side of the price), fee included. Cross-checked against Uniswap's own quoter for Uniswap v3."
        : "Constant-product (x*y=k) estimate with a 0.30% fee.",
    rejectedPools: reading.poolsRejected,
    disclaimer: DISCLAIMER,
  };
}

export function check(doc: LatestDoc | null, symbol: string, usd: number | undefined, side: "buy" | "sell"): Verdict & { symbol: string; readAt?: string; quote?: ImpactQuote } {
  const reading = findReading(doc, symbol);
  let quote: ImpactQuote | undefined;
  if (reading?.status === "ok" && reading.poolUsed && usd) quote = quoteImpact(reading.poolUsed as PoolRead, 8, usd, side);
  const v = verdictFor(reading, quote, ageSec(doc));
  return { ...v, symbol: reading?.symbol ?? symbol, readAt: reading?.readAt, quote };
}

export function thresholdsDoc() {
  return {
    ...THRESHOLDS,
    states: {
      Fresh: "DEX price within driftBps of the reference, reference not older than maxReferenceAgeSec, pool passes the depth guard.",
      Stale: "Reference older than maxReferenceAgeSec (frozen feed: off-hours, weekend, holiday or corporate-action pause). Comparison is not reliable.",
      Drifting: "DEX price between driftBps and brokenBps away from the reference.",
      Broken: "DEX price beyond brokenBps, spot disagrees with TWAP or another deep pool beyond the allowed bps, or the multiplier changed between readings.",
    },
  };
}
