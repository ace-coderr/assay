import { createPublicClient, http, parseAbi, zeroAddress, type PublicClient } from "viem";
import { base } from "viem/chains";
import { THRESHOLDS as T } from "./thresholds.js";
import { tickPrice, v3Price } from "./math.js";
import type { PoolRead, TokenRef } from "./types.js";

export const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
export const UNI_V3_FACTORY = "0x33128a8fC17869897dcE68Ed026d694621f6FDfD" as const;
export const AERO_V2_FACTORY = "0x420DD381b31aEf6683db6B902084cB0FFECe40Da" as const;
export const API_BASE = "https://api.coinbase.com/v1/tokenized-stocks";
export const FEE_TIERS = [100, 500, 3000, 10000] as const;

export const DEFAULT_RPCS = ["https://mainnet.base.org", "https://base-rpc.publicnode.com"];

export function makeClient(rpcUrl?: string): PublicClient {
  return createPublicClient({ chain: base, transport: http(rpcUrl ?? process.env.BASE_RPC_URL ?? DEFAULT_RPCS[0]) }) as PublicClient;
}

const v3Factory = parseAbi(["function getPool(address,address,uint24) view returns (address)"]);
const v2Factory = parseAbi(["function getPool(address,address,bool) view returns (address)"]);
const v3Pool = parseAbi([
  "function slot0() view returns (uint160 sqrtPriceX96,int24 tick,uint16,uint16,uint16,uint8,bool)",
  "function liquidity() view returns (uint128)",
  "function token0() view returns (address)",
  "function tickSpacing() view returns (int24)",
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

interface Found {
  venue: PoolRead["venue"];
  pool: `0x${string}`;
  feeBps?: number;
}

/** Find every USDC-quoted Uniswap v3 / Aerodrome v2 pool for each token. */
export async function discoverPools(client: PublicClient, tokens: TokenRef[]): Promise<Map<string, Found[]>> {
  const calls: { tok: TokenRef; venue: Found["venue"]; fee?: number; contract: any }[] = [];
  const contracts: any[] = [];
  for (const tok of tokens) {
    for (const fee of FEE_TIERS) {
      calls.push({ tok, venue: "uniswap-v3", fee, contract: null });
      contracts.push({ address: UNI_V3_FACTORY, abi: v3Factory, functionName: "getPool", args: [tok.address, USDC, fee] });
    }
    calls.push({ tok, venue: "aerodrome-v2", contract: null });
    contracts.push({ address: AERO_V2_FACTORY, abi: v2Factory, functionName: "getPool", args: [tok.address, USDC, false] });
  }
  const res = await client.multicall({ contracts, allowFailure: true });
  const map = new Map<string, Found[]>();
  res.forEach((r, i) => {
    if (r.status !== "success" || r.result === zeroAddress) return;
    const c = calls[i]!;
    const arr = map.get(c.tok.address) ?? [];
    arr.push({ venue: c.venue, pool: r.result as `0x${string}`, feeBps: c.fee ? c.fee / 100 : undefined });
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
  const v3 = found.filter((f) => f.venue === "uniswap-v3");
  const v2 = found.filter((f) => f.venue === "aerodrome-v2");
  if (v3.length) {
    const contracts = v3.flatMap((f) => [
      { address: f.pool, abi: v3Pool, functionName: "slot0" },
      { address: f.pool, abi: v3Pool, functionName: "liquidity" },
      { address: f.pool, abi: v3Pool, functionName: "token0" },
      { address: f.pool, abi: v3Pool, functionName: "tickSpacing" },
      { address: f.pool, abi: v3Pool, functionName: "observe", args: [[T.twapWindowSec, 0]] },
      { address: USDC, abi: erc20, functionName: "balanceOf", args: [f.pool] },
    ]);
    const r = await client.multicall({ contracts: contracts as any, allowFailure: true, blockNumber: block });
    v3.forEach((f, i) => {
      const [s0, liq, t0, ts, obs, bal] = r.slice(i * 6, i * 6 + 6);
      if (s0?.status !== "success" || liq?.status !== "success" || t0?.status !== "success" || bal?.status !== "success") return;
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
        venue: "uniswap-v3",
        pool: f.pool,
        feeBps: f.feeBps,
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
