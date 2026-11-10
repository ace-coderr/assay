export type State = "Fresh" | "Stale" | "Drifting" | "Broken";

export interface TokenRef {
  address: `0x${string}`;
  symbol: string;
  name: string;
  decimals: number;
  isin?: string;
  /** Multiplier as reported by the API / chain (human number, 1 = no adjustment). */
  multiplier: number;
  totalSupply?: number;
  navPrice?: number;
  navUpdatedAt?: string;
}

export interface PoolRead {
  venue: "uniswap-v3" | "aerodrome-v2";
  pool: `0x${string}`;
  feeBps?: number;
  /** USDC per 1 token (spot, from slot0 or reserves). */
  spotPrice: number;
  /** USDC held by the pool, in USDC units. Proxy for depth. */
  usdcDepth: number;
  /** Uniswap v3 in-range liquidity; absent for v2. Zero means the spot price is meaningless. */
  liquidity?: bigint;
  /** 30 minute TWAP in USDC per token, when the pool has enough oracle history. */
  twapPrice?: number | null;
  twapNote?: string;
  tick?: number;
  tickSpacing?: number;
  /** Nearest initialized ticks around the current tick: bounds of the active liquidity range. */
  tickLower?: number;
  tickUpper?: number;
  /** USD needed to push this pool spot price 1% (cheaper direction): the manipulation cost. */
  costToMove100bpsUsd?: number;
  /** The active liquidity range ends before a 1% move: the true cost is higher. */
  costRangeLimited?: boolean;
  /** token0 is the stock token (affects impact math). */
  tokenIsToken0?: boolean;
  sqrtPriceX96?: bigint;
}

export interface Reading {
  symbol: string;
  address: `0x${string}`;
  status: "ok" | "unavailable";
  unavailableReason?: string;
  /** Machine-readable reason a reading is unavailable, so UIs can show a precise state. */
  unavailableCode?: "no-reference" | "no-pool" | "pool-too-thin" | "source-error";
  state?: State;
  reasons: string[];
  dexPrice?: number;
  reference?: number;
  referenceUpdatedAt?: string;
  referenceAgeSec?: number;
  multiplier: number;
  /** nav_price / multiplier: implied underlying share price. */
  underlyingPrice?: number;
  deviationBps?: number;
  twapDivergenceBps?: number;
  poolUsed?: PoolRead;
  poolsConsidered: number;
  poolsRejected: { pool: string; why: string }[];
  readAt: string;
  block?: string;
}
