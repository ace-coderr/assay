import { createPublicClient, fallback, http, parseAbi, zeroAddress, type PublicClient } from "viem";
import { base } from "viem/chains";
import { THRESHOLDS as T } from "./thresholds.js";
import { costToMoveUsd, manipulationCost, tickPrice, v3Price } from "./math.js";
import { isConcentrated, type PoolRead, type TokenRef, type Venue } from "./types.js";

export const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
export const UNI_V3_FACTORY = "0x33128a8fC17869897dcE68Ed026d694621f6FDfD" as const;
export const AERO_V2_FACTORY = "0x420DD381b31aEf6683db6B902084cB0FFECe40Da" as const;
/**
 * Aerodrome concentrated-liquidity factories that hold the tokenized-stock pools. Both were verified on-chain
 * (getPool returns the pools; see docs/coverage.md). The older Slipstream factory 0x5e7BB104...406809A was checked
 * too and holds no stock-token pools.
 */
export const AERO_CL_FACTORIES = [
  "0x9CB220581b91b0C83223012FE69688b92aD07a76",
  "0xf8f2eB4940CFE7d13603DDDD87f123820Fc061Ef",
] as const;
export const AERO_CL_TICK_SPACINGS = [1, 10, 50, 100, 200, 2000] as const;
export const API_BASE = "https://api.coinbase.com/v1/tokenized-stocks";
export const FEE_TIERS = [100, 500, 3000, 10000] as const;

export const DEFAULT_RPCS = ["https://base-rpc.publicnode.com", "https://mainnet.base.org"];

export function makeClient(rpcUrl?: string): PublicClient {
  const urls = rpcUrl ?? process.env.BASE_RPC_URL ? [rpcUrl ?? process.env.BASE_RPC_URL!, ...DEFAULT_RPCS] : DEFAULT_RPCS;
  return createPublicClient({
    chain: base,
    transport: fallback(urls.map((u) => http(u, { timeout: 12_000, retryCount: 1 }))),
  }) as PublicClient;
}

const v3Factory = parseAbi(["function getPool(address,address,uint24) view returns (address)"]);
const v2Factory = parseAbi(["function getPool(address,address,bool) view returns (address)"]);
const clFactory = parseAbi(["function getPool(address,address,int24) view returns (address)"]);
const v3Pool = parseAbi([
  // Only the first two outputs are declared: Uniswap v3, PancakeSwap v3 and Slipstream differ after them.
  "function slot0() view returns (uint160 sqrtPriceX96,int24 tick)",
  "function liquidity() view returns (uint128)",
  "function token0() view returns (address)",
  "function fee() view returns (uint24)",
  "function tickSpacing() view returns (int24)",
  "function tickBitmap(int16 wordPos) view returns (uint256)",
  // Only the first two outputs are declared: Uniswap v3 and Slipstream append further fields.
  "function ticks(int24 tick) view returns (uint128 liquidityGross, int128 liquidityNet)",
  "function observe(uint32[] secondsAgos) view returns (int56[] tickCumulatives, uint160[] secondsPerLiquidityCumulativeX128s)",
]);
const v2Pool = parseAbi([
  "function getReserves() view returns (uint256,uint256,uint256)",
  "function token0() view returns (address)",
]);
const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)", "function multiplier() view returns (uint256)"]);

export interface ApiToken {
  contract_address: string;
  symbol: string;
  name: string;
  decimals: number;
  isin?: string;
  multiplier: number;
  total_supply?: number;
  nav_price?: number;
  nav_price_updated_at?: string;
}

export function toTokenRef(t: ApiToken): TokenRef {
  return {
    address: t.contract_address as `0x${string}`,
    symbol: t.symbol,
    name: t.name,
    decimals: t.decimals,
    isin: t.isin,
    multiplier: t.multiplier,
    totalSupply: t.total_supply,
    navPrice: t.nav_price,
    navUpdatedAt: t.nav_price_updated_at,
  };
}

/** Fetch every token record from the Tokenized Stocks API (follows pagination). */
export async function fetchTokens(fetchFn: typeof fetch = fetch): Promise<ApiToken[]> {
  const out: ApiToken[] = [];
  let pageToken: string | undefined;
  for (let i = 0; i < 20; i++) {
    const u = new URL(API_BASE);
    u.searchParams.set("page_size", "500");
    if (pageToken) u.searchParams.set("page_token", pageToken);
    const res = await fetchFn(u, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`Tokenized Stocks API ${res.status}`);
    const j = (await res.json()) as { tokens?: ApiToken[]; next_page_token?: string };
    out.push(...(j.tokens ?? []));
    pageToken = j.next_page_token;
    if (!pageToken) break;
  }
  return out;
}

export interface Found {
  venue: Venue;
  factory?: `0x${string}`;
  pool: `0x${string}`;
  feeBps?: number;
}

/** Find every USDC-quoted Uniswap v3, Aerodrome v2 and Aerodrome Slipstream pool for each token. */
export async function discoverPools(client: PublicClient, tokens: TokenRef[]): Promise<Map<string, Found[]>> {
  const calls: { tok: TokenRef; venue: Venue; factory: `0x${string}`; fee?: number }[] = [];
  const contracts: any[] = [];
  for (const tok of tokens) {
    for (const fee of FEE_TIERS) {
      calls.push({ tok, venue: "uniswap-v3", factory: UNI_V3_FACTORY, fee });
      contracts.push({ address: UNI_V3_FACTORY, abi: v3Factory, functionName: "getPool", args: [tok.address, USDC, fee] });
    }
    calls.push({ tok, venue: "aerodrome-v2", factory: AERO_V2_FACTORY });
    contracts.push({ address: AERO_V2_FACTORY, abi: v2Factory, functionName: "getPool", args: [tok.address, USDC, false] });
    for (const factory of AERO_CL_FACTORIES) {
      for (const ts of AERO_CL_TICK_SPACINGS) {
        calls.push({ tok, venue: "aerodrome-slipstream", factory });
        contracts.push({ address: factory, abi: clFactory, functionName: "getPool", args: [tok.address, USDC, ts] });
      }
    }
  }
  const res = await client.multicall({ contracts, allowFailure: true });
  const map = new Map<string, Found[]>();
  res.forEach((r, i) => {
    if (r.status !== "success" || r.result === zeroAddress) return;
    const c = calls[i]!;
    const arr = map.get(c.tok.address) ?? [];
    arr.push({ venue: c.venue, factory: c.factory, pool: r.result as `0x${string}`, feeBps: c.fee ? c.fee / 100 : undefined });
    map.set(c.tok.address, arr);
  });
  return map;
}

/** Read spot price, depth, liquidity and 30 min TWAP for the given pools. */
export async function readPools(
  client: PublicClient,
  token: TokenRef,
  found: Found[],
): Promise<{ pools: PoolRead[]; block: bigint }> {
  const block = await client.getBlockNumber();
  const pools: PoolRead[] = [];
  const v3 = found.filter((f) => isConcentrated(f.venue));
  const v2 = found.filter((f) => f.venue === "aerodrome-v2");
  if (v3.length) {
    const contracts = v3.flatMap((f) => [
      { address: f.pool, abi: v3Pool, functionName: "slot0" },
      { address: f.pool, abi: v3Pool, functionName: "liquidity" },
      { address: f.pool, abi: v3Pool, functionName: "token0" },
      { address: f.pool, abi: v3Pool, functionName: "tickSpacing" },
      { address: f.pool, abi: v3Pool, functionName: "observe", args: [[T.twapWindowSec, 0]] },
      { address: USDC, abi: erc20, functionName: "balanceOf", args: [f.pool] },
      { address: f.pool, abi: v3Pool, functionName: "fee" },
    ]);
    const r = await client.multicall({ contracts: contracts as any, allowFailure: true, blockNumber: block });
    v3.forEach((f, i) => {
      const [s0, liq, t0, ts, obs, bal, feeRes] = r.slice(i * 7, i * 7 + 7);
      if (s0?.status !== "success" || liq?.status !== "success" || t0?.status !== "success" || bal?.status !== "success") return;
      // The pool's own fee() is authoritative (Slipstream fees are dynamic); fall back to the tier it was found at.
      const feeBps = feeRes?.status === "success" ? Number(feeRes.result) / 100 : f.feeBps;
      const slot = s0.result as unknown as readonly [bigint, number];
      const tokenIsToken0 = (t0.result as string).toLowerCase() === token.address.toLowerCase();
      let twapPrice: number | null = null;
      let twapNote: string | undefined;
      if (obs?.status === "success") {
        const cum = (obs.result as unknown as readonly [readonly bigint[], readonly bigint[]])[0];
        const avgTick = Number(cum[1]! - cum[0]!) / T.twapWindowSec;
        twapPrice = tickPrice(avgTick, tokenIsToken0, token.decimals);
      } else {
        twapNote = "observe() reverted: pool oracle cardinality too small for a 30 minute window";
      }
      pools.push({
        venue: f.venue,
        factory: f.factory,
        pool: f.pool,
        feeBps,
        spotPrice: v3Price(slot[0], tokenIsToken0, token.decimals),
        usdcDepth: Number(bal.result as bigint) / 1e6,
        liquidity: liq.result as bigint,
        sqrtPriceX96: slot[0],
        tick: Number(slot[1]),
        tickSpacing: ts?.status === "success" ? Number(ts.result) : undefined,
        tokenIsToken0,
        twapPrice,
        twapNote,
      });
    });
  }
  await attachActiveRange(client, pools, block, token.decimals);
  if (v2.length) {
    const contracts = v2.flatMap((f) => [
      { address: f.pool, abi: v2Pool, functionName: "getReserves" },
      { address: f.pool, abi: v2Pool, functionName: "token0" },
    ]);
    const r = await client.multicall({ contracts: contracts as any, allowFailure: true, blockNumber: block });
    v2.forEach((f, i) => {
      const [rs, t0] = r.slice(i * 2, i * 2 + 2);
      if (rs?.status !== "success" || t0?.status !== "success") return;
      const [r0, r1] = rs.result as unknown as readonly [bigint, bigint];
      const tokenIsToken0 = (t0.result as string).toLowerCase() === token.address.toLowerCase();
      const tokRes = Number(tokenIsToken0 ? r0 : r1) / 10 ** token.decimals;
      const usdcRes = Number(tokenIsToken0 ? r1 : r0) / 1e6;
      if (tokRes <= 0) return;
      pools.push({
        venue: "aerodrome-v2",
        factory: f.factory,
        pool: f.pool,
        spotPrice: usdcRes / tokRes,
        usdcDepth: usdcRes,
        tokenIsToken0,
        twapPrice: null,
        twapNote: "constant-product pool: no onchain TWAP read",
      });
    });
  }
  return { pools, block };
}

/** Current onchain multiplier (WAD) as a number. */
export async function readMultiplier(client: PublicClient, address: `0x${string}`): Promise<number> {
  const m = await client.readContract({ address, abi: erc20, functionName: "multiplier" });
  return Number(m) / 1e18;
}

/** Ticks are read this far (in tick units, each way) around the current tick: about 3% of price. */
export const TICK_WINDOW = 300;
/** The same window expressed in bps of price, as walkSwap expects it. */
export const TICK_WINDOW_BPS = (Math.pow(1.0001, TICK_WINDOW) - 1) * 1e4;
const MAX_TICKS_PER_POOL = 200;

/**
 * For each concentrated-liquidity pool with live liquidity, read every initialized tick within +/- TICK_WINDOW of the
 * current tick (tickBitmap, then ticks().liquidityNet) and compute the real cost to push the price 1%.
 * Pools without liquidity or depth are skipped: they are rejected anyway.
 */
async function attachActiveRange(client: PublicClient, pools: PoolRead[], block: bigint, tokenDecimals: number): Promise<void> {
  const cand = pools.filter(
    (p) => isConcentrated(p.venue) && p.tick != null && p.tickSpacing && (p.liquidity ?? 0n) > 0n && p.usdcDepth >= T.minDepthUsd,
  );
  if (!cand.length) return;

  // 1. Bitmap words covering the window.
  const plan = cand.map((p) => {
    const ts = p.tickSpacing!;
    const lo = Math.floor((p.tick! - TICK_WINDOW) / ts);
    const hi = Math.floor((p.tick! + TICK_WINDOW) / ts);
    const words: number[] = [];
    for (let w = Math.floor(lo / 256); w <= Math.floor(hi / 256); w++) words.push(w);
    return { p, ts, lo, hi, words };
  });
  const wordCalls = plan.flatMap((x) => x.words.map((w) => ({ address: x.p.pool, abi: v3Pool, functionName: "tickBitmap", args: [w] })));
  const wordRes = await client.multicall({ contracts: wordCalls as any, allowFailure: true, blockNumber: block });
  let wi = 0;
  const initialized: { p: PoolRead; ticks: number[] }[] = [];
  for (const x of plan) {
    const words = x.words.map(() => wordRes[wi++]);
    if (words.some((r) => r?.status !== "success")) continue;
    const ticks: number[] = [];
    for (let c = x.lo; c <= x.hi; c++) {
      const w = Math.floor(c / 256);
      const word = words[w - Math.floor(x.lo / 256)]!.result as bigint;
      if (((word >> BigInt(((c % 256) + 256) % 256)) & 1n) === 1n) ticks.push(c * x.ts);
    }
    if (ticks.length <= MAX_TICKS_PER_POOL) initialized.push({ p: x.p, ticks });
  }

  // 2. liquidityNet of every initialized tick.
  const tickCalls = initialized.flatMap((x) => x.ticks.map((t) => ({ address: x.p.pool, abi: v3Pool, functionName: "ticks", args: [t] })));
  const tickRes = tickCalls.length ? await client.multicall({ contracts: tickCalls as any, allowFailure: true, blockNumber: block }) : [];
  let ti = 0;
  for (const x of initialized) {
    const list: { tick: number; liquidityNet: bigint }[] = [];
    let ok = true;
    for (const t of x.ticks) {
      const r = tickRes[ti++];
      if (r?.status === "success") list.push({ tick: t, liquidityNet: (r.result as readonly [bigint, bigint])[1] });
      else ok = false;
    }
    const p = x.p;
    const below = list.filter((t) => t.tick <= p.tick!).map((t) => t.tick);
    const above = list.filter((t) => t.tick > p.tick!).map((t) => t.tick);
    p.tickLower = below.length ? Math.max(...below) : undefined;
    p.tickUpper = above.length ? Math.min(...above) : undefined;
    if (!ok) {
      // Partial tick data would give a wrong answer: use the conservative single-range bound instead.
      const m = costToMoveUsd({ sqrtPriceX96: p.sqrtPriceX96!, liquidity: p.liquidity!, tick: p.tick!, tickSpacing: p.tickSpacing!, tickLower: p.tickLower, tickUpper: p.tickUpper, tokenIsToken0: !!p.tokenIsToken0, tokenDecimals, bps: 100 });
      if (m) { p.costToMove100bpsUsd = m.usd; p.costRangeLimited = true; }
      continue;
    }
    p.ticks = list;
    p.tickWindowBps = TICK_WINDOW_BPS;
    const m = manipulationCost({
      sqrtPriceX96: p.sqrtPriceX96!,
      liquidity: p.liquidity!,
      tick: p.tick!,
      ticks: list,
      windowBps: TICK_WINDOW_BPS,
      tokenIsToken0: !!p.tokenIsToken0,
      tokenDecimals,
      feeBps: p.feeBps ?? 0,
      side: "buy",
      bps: 100,
    });
    if (m) {
      p.costToMove100bpsUsd = m.usd;
      p.costRangeLimited = m.windowExceeded;
    }
  }
}
