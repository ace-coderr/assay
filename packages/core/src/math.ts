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
 * Read-only cost of absorbing `usdc` worth of the stock token in a Uniswap v3 pool,
 * assuming liquidity stays at the current in-range value. Fees are included.
 * Nothing here builds or sends a transaction.
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
