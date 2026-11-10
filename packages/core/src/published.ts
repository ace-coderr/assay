import { DISCLAIMER, quoteImpact, verdictFor, type ImpactQuote, type Verdict } from "./verdict.js";
import { THRESHOLDS } from "./thresholds.js";
import { isConcentrated, type PoolRead, type Reading } from "./types.js";

/**
 * Shapes of the JSON the pipeline publishes, and the read-only logic that works on them. Shared by the pipeline,
 * the website (in the browser) and the MCP server, so every consumer computes the same answers.
 * Nothing here can sign, send or prepare a transaction.
 */

/** Readings are produced on a 10 minute schedule. GitHub cron is best-effort, so thresholds allow for lag. */
export const CADENCE_MIN = 10;
/** The board is flagged as late after this many seconds without a new reading (3 missed runs). */
export const BOARD_LATE_SEC = 30 * 60;
/** check_before_trade refuses to judge a reading older than this (4 missed runs). */
export const VERDICT_MAX_AGE_SEC = 45 * 60;
export const MAX_SIZE_USD = 1_000_000;

export interface SourceStatus {
  ok: boolean;
  at: string;
  error?: string;
}

export interface LatestDoc {
  updatedAt: string;
  block?: string;
  sources: { tokensApi: SourceStatus; rpc: SourceStatus };
  /** Tokens in the Tokenized Stocks API with no reference value (cannot be assayed). */
  untracked: number;
  totalTokens: number;
  untrackedTokens?: { symbol: string; multiplier: number }[];
  readings: Reading[];
}

export interface RunRecord {
  at: string;
  durationMs: number;
  ok: boolean;
  error?: string;
  steps: Record<string, number>;
  consecutiveFailures: number;
}

export interface HistoryPoint {
  t: string;
  dex: number;
  ref: number;
  devBps: number;
  state: string;
  depth: number;
}

export interface StateEvent {
  t: string;
  symbol: string;
  from: string | null;
  to: string;
  reason: string;
}

export interface ActionEvent {
  kind: "announcement" | "multiplier-scheduled" | "multiplier-change-detected";
  symbol: string;
  address: string;
  block?: string;
  tx?: string;
  detectedAt: string;
  id?: string;
  description?: string;
  uri?: string;
  actionId?: string;
  old?: number;
  new?: number;
  effectiveAt?: string;
}

export const ageSec = (updatedAt: string | undefined | null, now = Date.now()): number =>
  updatedAt ? (now - Date.parse(updatedAt)) / 1000 : Infinity;

export function findReading(doc: LatestDoc | null | undefined, symbol: string): Reading | undefined {
  const s = symbol.trim().toLowerCase();
  const hit = doc?.readings.find((r) => r.symbol.toLowerCase() === s || r.symbol.toLowerCase() === s + "c");
  if (hit) return hit;
  // A real token that simply has no reference value: an explained "unavailable" reading, not an error.
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

/** Quote the cost of a size against the pool a reading is based on. A read-only estimate. */
export function probe(reading: Reading | undefined, symbol: string, usd: number, side: "buy" | "sell") {
  if (!reading) return { ok: false as const, status: "unknown" as const, error: `unknown symbol: ${symbol}` };
  if (reading.status !== "ok" || !reading.poolUsed) {
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
    label: quote.lowerBound ? ("AT_LEAST" as const) : ("ESTIMATE" as const),
    explanation: quote.lowerBound
      ? "At least: this size needs more liquidity than Assay read around the current price (about 3% each side), so the true cost is higher than shown."
      : "Estimate from a tick-by-tick simulation over the liquidity read on-chain, fee included.",
    method: isConcentrated(pool.venue)
      ? "Simulated tick by tick over the initialized ticks read on-chain (about 3% each side of the price), fee included. Cross-checked against Uniswap's own quoter for Uniswap v3."
      : "Constant-product (x*y=k) estimate with a 0.30% fee.",
    rejectedPools: reading.poolsRejected,
    disclaimer: DISCLAIMER,
  };
}

/** Verdict only (ok, caution, avoid, unknown). Never executes or prepares a trade. */
export function check(
  reading: Reading | undefined,
  symbol: string,
  usd: number | undefined,
  side: "buy" | "sell",
  readingAgeSec: number,
): Verdict & { symbol: string; readAt?: string; quote?: ImpactQuote } {
  let quote: ImpactQuote | undefined;
  if (reading?.status === "ok" && reading.poolUsed && usd) quote = quoteImpact(reading.poolUsed as PoolRead, 8, usd, side);
  const v = verdictFor(reading, quote, readingAgeSec, VERDICT_MAX_AGE_SEC);
  return { ...v, symbol: reading?.symbol ?? symbol, readAt: reading?.readAt, quote };
}

export function thresholdsDoc() {
  return {
    ...THRESHOLDS,
    cadenceMin: CADENCE_MIN,
    boardLateSec: BOARD_LATE_SEC,
    verdictMaxAgeSec: VERDICT_MAX_AGE_SEC,
    states: {
      Fresh: "DEX price within driftBps of the reference, reference not older than maxReferenceAgeSec, pool passes the guards.",
      Stale: "Reference older than maxReferenceAgeSec (frozen feed: off-hours, weekend, holiday or corporate-action pause). Comparison is not reliable.",
      Drifting: "DEX price between driftBps and brokenBps away from the reference.",
      Broken: "DEX price beyond brokenBps, spot disagrees with TWAP or another deep pool beyond the allowed bps, or the multiplier changed between readings.",
    },
  };
}

export function parseSize(v: unknown): number | { error: string } {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n <= 0) return { error: "usd must be a positive number" };
  if (n > MAX_SIZE_USD) return { error: `usd must be at most ${MAX_SIZE_USD}` };
  return n;
}
