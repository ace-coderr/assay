const Q96 = 2 ** 96;

/** USDC per token from a Uniswap v3 sqrtPriceX96. Token decimals vs USDC (6). */
export function v3Price(sqrtPriceX96: bigint, tokenIsToken0: boolean, tokenDecimals: number, quoteDecimals = 6): number {
  const r = Number(sqrtPriceX96) / Q96;
  const raw = r * r; // token1 per token0, raw units
  const scale = 10 ** (tokenDecimals - quoteDecimals);
  return (tokenIsToken0 ? raw : 1 / raw) * scale;
}

/** USDC per token from a tick (used for TWAP). */
export function tickPrice(tick: number, tokenIsToken0: boolean, tokenDecimals: number, quoteDecimals = 6): number {
  const raw = Math.pow(1.0001, tick);
  const scale = 10 ** (tokenDecimals - quoteDecimals);
  return (tokenIsToken0 ? raw : 1 / raw) * scale;
}

export function deviationBps(dex: number, reference: number): number {
  return ((dex - reference) / reference) * 10_000;
}

export function bps(a: number, b: number): number {
  return Math.abs(deviationBps(a, b));
}

export interface ImpactResult {
  /** Cost versus spot for the whole size, in bps (fee included). Positive = worse for the trader. */
  slippageBps: number;
  /** Spot price after the size is absorbed. */
  endPrice: number;
  /** True if the size would leave the current liquidity range: result is a lower bound only. */
  exceedsRange: boolean;
}

/**
 * Constant-liquidity estimate of absorbing `usdc` worth of the stock token in a concentrated-liquidity pool,
 * assuming liquidity stays at the current in-range value. Used only when per-tick data is unavailable;
 * `walkSwap` is exact across ticks. Fees are included. Nothing here builds or sends a transaction.
 */
export function v3Impact(opts: {
  sqrtPriceX96: bigint;
  liquidity: bigint;
  tick: number;
  tickSpacing: number;
  /** Initialized ticks bounding the active range. Falls back to one tick spacing (very conservative). */
  tickLower?: number;
  tickUpper?: number;
  tokenIsToken0: boolean;
  tokenDecimals: number;
  feeBps: number;
  usdc: number;
  side: "buy" | "sell";
}): ImpactResult | null {
  const L = Number(opts.liquidity);
  if (L <= 0 || opts.usdc <= 0) return null;
  const sp0 = Number(opts.sqrtPriceX96) / Q96;
  const feeMul = 1 - opts.feeBps / 10_000;
  // sqrtP = sqrt(token1/token0). USDC is token1 when the stock token is token0.
  const usdcIsToken1 = opts.tokenIsToken0;
  const spot = v3Price(opts.sqrtPriceX96, opts.tokenIsToken0, opts.tokenDecimals);
  let sp1: number;
  if (opts.side === "buy") {
    const dUsdc = opts.usdc * 1e6 * feeMul;
    sp1 = usdcIsToken1 ? sp0 + dUsdc / L : 1 / (1 / sp0 + dUsdc / L);
  } else {
    const dTok = (opts.usdc / spot) * 10 ** opts.tokenDecimals * feeMul;
    sp1 = usdcIsToken1 ? 1 / (1 / sp0 + dTok / L) : sp0 + dTok / L;
  }
  const priceAt = (sp: number) => {
    const raw = sp * sp;
    return (opts.tokenIsToken0 ? raw : 1 / raw) * 10 ** (opts.tokenDecimals - 6);
  };
  const p0 = priceAt(sp0);
  const p1 = priceAt(sp1);
  // Exact average execution price for constant-L movement between sqrt prices.
  const avg = (p0 + p1) / 2;
  const move = opts.side === "buy" ? (avg - p0) / p0 : (p0 - avg) / p0;
  const tickEnd = Math.log(sp1 * sp1) / Math.log(1.0001);
  const lo = opts.tickLower ?? Math.floor(opts.tick / opts.tickSpacing) * opts.tickSpacing;
  const hi = opts.tickUpper ?? lo + opts.tickSpacing;
  const exceedsRange = tickEnd < lo || tickEnd >= hi;
  return { slippageBps: move * 1e4 + opts.feeBps, endPrice: p1, exceedsRange };
}

export interface TickLiq {
  /** Initialized tick index. */
  tick: number;
  /** Net liquidity added when the price crosses this tick upward (subtracted when crossing downward). */
  liquidityNet: bigint;
}

export interface WalkResult {
  /** Gross input spent in USD (USDC for a buy; stock sold valued at the starting spot for a sell). */
  usdIn: number;
  /** Average execution price vs the starting spot, in bps (fee included). Positive = worse for the trader. */
  slippageBps: number;
  endPrice: number;
  /** Spot price moved this many bps from the start. */
  movedBps: number;
  /** The simulation needed liquidity data beyond the loaded tick window, so the result is a lower bound. */
  windowExceeded: boolean;
  /** Number of initialized ticks crossed. */
  ticksCrossed: number;
}

export interface WalkInput {
  sqrtPriceX96: bigint;
  liquidity: bigint;
  tick: number;
  /** Initialized ticks read on-chain around the current tick. */
  ticks: TickLiq[];
  /** How far (in bps of price, each way) the tick data reaches. */
  windowBps: number;
  tokenIsToken0: boolean;
  tokenDecimals: number;
  feeBps: number;
  side: "buy" | "sell";
}

/**
 * Fee-aware swap simulation across the initialized ticks of a concentrated-liquidity pool. Read-only math:
 * it never builds a transaction. Provide `usdBudget` to simulate a trade of that size, or `targetBps` to find
 * what it costs to push the price that far (the manipulation cost).
 */
export function walkSwap(opts: WalkInput & { usdBudget?: number; targetBps?: number }): WalkResult | null {
  const tokScale = 10 ** opts.tokenDecimals;
  const sp0 = Number(opts.sqrtPriceX96) / Q96;
  const spot0 = v3Price(opts.sqrtPriceX96, opts.tokenIsToken0, opts.tokenDecimals);
  const feeMul = 1 - opts.feeBps / 1e4;
  // Buying pushes the token price up, selling pushes it down. The sqrt price moves up iff (buy and token0) or (sell and token1).
  const up = (opts.side === "buy") === opts.tokenIsToken0;
  const sorted = [...opts.ticks].sort((a, b) => a.tick - b.tick);
  const sq = (t: number) => Math.sqrt(Math.pow(1.0001, t));
  const winUp = sp0 * Math.sqrt(1 + opts.windowBps / 1e4);
  const winDown = sp0 / Math.sqrt(1 + opts.windowBps / 1e4);

  // Budget (after fee) in raw units of the input token: USDC (6 dec) for a buy, the stock token for a sell.
  let remaining = Infinity;
  if (opts.usdBudget != null) {
    if (opts.usdBudget <= 0) return null;
    remaining = (opts.side === "buy" ? opts.usdBudget * 1e6 : (opts.usdBudget / spot0) * tokScale) * feeMul;
  }
  // Target sqrt price for "cost to move the token price by targetBps".
  let spTarget: number | null = null;
  if (opts.targetBps != null) {
    const d = (opts.side === "buy" ? 1 : -1) * (opts.targetBps / 1e4);
    spTarget = opts.tokenIsToken0 ? sp0 * Math.sqrt(1 + d) : sp0 / Math.sqrt(1 + d);
  }

  let L = Number(opts.liquidity);
  let sp = sp0;
  let curTick = opts.tick;
  let inRaw = 0;
  let outRaw = 0;
  let crossed = 0;
  let windowExceeded = false;

  for (let guard = 0; guard < 5000; guard++) {
    let boundary: TickLiq | undefined;
    if (up) boundary = sorted.find((t) => t.tick > curTick);
    else for (let i = sorted.length - 1; i >= 0; i--) if (sorted[i]!.tick <= curTick) { boundary = sorted[i]; break; }
    const edge = up ? winUp : winDown;
    let spEnd = boundary ? sq(boundary.tick) : edge;
    const pastWindow = up ? spEnd > edge : spEnd < edge;
    if (pastWindow) spEnd = edge;
    const hitsTarget = spTarget != null && (up ? spTarget <= spEnd : spTarget >= spEnd);
    if (hitsTarget) spEnd = spTarget!;

    if (L > 0) {
      const need = up ? L * (spEnd - sp) : L * (1 / spEnd - 1 / sp);
      if (need <= remaining) {
        inRaw += need;
        outRaw += up ? L * (1 / sp - 1 / spEnd) : L * (sp - spEnd);
        remaining -= need;
        sp = spEnd;
      } else {
        // The budget runs out inside this segment.
        const spStop = up ? sp + remaining / L : 1 / (1 / sp + remaining / L);
        inRaw += remaining;
        outRaw += up ? L * (1 / sp - 1 / spStop) : L * (sp - spStop);
        sp = spStop;
        remaining = 0;
      }
    } else {
      sp = spEnd; // empty range: the price moves through at no cost
    }
    if (hitsTarget || remaining <= 1e-9) break;
    if (pastWindow || !boundary) {
      windowExceeded = true; // would need liquidity data beyond what was read
      break;
    }
    L += up ? Number(boundary.liquidityNet) : -Number(boundary.liquidityNet);
    curTick = up ? boundary.tick : boundary.tick - 1;
    crossed++;
  }

  const endPrice = v3Price(BigInt(Math.floor(sp * Q96)), opts.tokenIsToken0, opts.tokenDecimals);
  let usdIn: number;
  let slippageBps: number;
  if (opts.side === "buy") {
    const grossUsdc = inRaw / 1e6 / feeMul;
    const stockOut = outRaw / tokScale;
    usdIn = grossUsdc;
    slippageBps = stockOut > 0 ? (grossUsdc / stockOut / spot0 - 1) * 1e4 : Infinity;
  } else {
    const grossStock = inRaw / tokScale / feeMul;
    const usdcOut = outRaw / 1e6;
    usdIn = grossStock * spot0;
    slippageBps = grossStock > 0 ? (1 - usdcOut / grossStock / spot0) * 1e4 : Infinity;
  }
  return { usdIn, slippageBps, endPrice, movedBps: (endPrice / spot0 - 1) * 1e4, windowExceeded, ticksCrossed: crossed };
}

/** Cheapest direction to push the token price by `bps`, using the real tick data. This is the manipulation cost. */
export function manipulationCost(opts: Omit<WalkInput, "side"> & { bps: number; side?: "buy" | "sell" }): { usd: number; side: "buy" | "sell"; windowExceeded: boolean } | null {
  const results = (["buy", "sell"] as const)
    .map((side) => ({ side, r: walkSwap({ ...opts, side, targetBps: opts.bps }) }))
    .filter((x): x is { side: "buy" | "sell"; r: WalkResult } => x.r != null);
  if (!results.length) return null;
  results.sort((a, b) => a.r.usdIn - b.r.usdIn);
  const best = results[0]!;
  return { usd: best.r.usdIn, side: best.side, windowExceeded: best.r.windowExceeded };
}

export interface MoveCost {
  /** USD a trader would need to spend to push the spot price `bps` away, in the cheaper direction. */
  usd: number;
  /** True when the active liquidity range ends first: the real cost is higher than `usd`. */
  rangeLimited: boolean;
}

/**
 * Cost to move a concentrated-liquidity pool spot price by `bps` assuming liquidity does not extend past the
 * active range. A conservative lower bound used only when per-tick data is unavailable; prefer `manipulationCost`.
 */
export function costToMoveUsd(opts: {
  sqrtPriceX96: bigint;
  liquidity: bigint;
  tick: number;
  tickSpacing: number;
  tickLower?: number;
  tickUpper?: number;
  tokenIsToken0: boolean;
  tokenDecimals: number;
  bps: number;
}): MoveCost | null {
  const L = Number(opts.liquidity);
  if (L <= 0) return null;
  const sp = Number(opts.sqrtPriceX96) / Q96;
  const price = v3Price(opts.sqrtPriceX96, opts.tokenIsToken0, opts.tokenDecimals);
  const lo = opts.tickLower ?? Math.floor(opts.tick / opts.tickSpacing) * opts.tickSpacing;
  const hi = opts.tickUpper ?? lo + opts.tickSpacing;
  const spLo = Math.sqrt(Math.pow(1.0001, lo));
  const spHi = Math.sqrt(Math.pow(1.0001, hi));
  const b = opts.bps / 1e4;
  const tokScale = 10 ** opts.tokenDecimals;

  const up = opts.tokenIsToken0 ? sp * Math.sqrt(1 + b) : sp / Math.sqrt(1 + b);
  const down = opts.tokenIsToken0 ? sp * Math.sqrt(1 - b) : sp / Math.sqrt(1 - b);
  const clamp = (t: number) => Math.min(spHi, Math.max(spLo, t));
  const upC = clamp(up);
  const downC = clamp(down);

  const buyUsdc = opts.tokenIsToken0 ? (L * Math.abs(upC - sp)) / 1e6 : (L * Math.abs(1 / upC - 1 / sp)) / 1e6;
  const sellTokens = opts.tokenIsToken0 ? (L * Math.abs(1 / downC - 1 / sp)) / tokScale : (L * Math.abs(downC - sp)) / tokScale;
  const sellUsd = sellTokens * price;
  return buyUsdc <= sellUsd ? { usd: buyUsdc, rangeLimited: upC !== up } : { usd: sellUsd, rangeLimited: downC !== down };
}
