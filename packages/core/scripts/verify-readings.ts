// Independent cross-check of Assay readings. Everything here is read-only (eth_call / eth_getStorage-style reads).
//  A. Pin one block and read the pool contract directly on three separate RPC providers: values must be identical.
//  B. Recompute the price from slot0 with exact BigInt arithmetic and compare with Assay's floating-point price.
//  C. Run the same trade through the DEX's own on-chain QuoterV2 (eth_call) and compare with Assay's tick-walk simulation.
import fs from "node:fs";
import { createPublicClient, http, parseAbi, type Hex, type PublicClient } from "viem";
import { base } from "viem/chains";
import { makeClient, discoverPools, readPools, toTokenRef, quoteImpact, v3Price, VENUE_LABEL, type ApiToken, type PoolRead } from "../src/index.js";

const RPCS = [
  { name: "publicnode", url: "https://base-rpc.publicnode.com" },
  { name: "base.org", url: "https://mainnet.base.org" },
  { name: "1rpc", url: "https://1rpc.io/base" },
  { name: "drpc", url: "https://base.drpc.org" },
];
const mk = (url: string): PublicClient => createPublicClient({ chain: base, transport: http(url, { timeout: 15000, retryCount: 2, retryDelay: 500 }) }) as PublicClient;
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as Hex;
const list = (JSON.parse(fs.readFileSync("fixtures/tokenized-stocks.list.json", "utf8")).tokens as ApiToken[]).map(toTokenRef);

const poolAbi = parseAbi(["function slot0() view returns (uint160 sqrtPriceX96,int24 tick)", "function liquidity() view returns (uint128)", "function token0() view returns (address)", "function fee() view returns (uint24)"]);
const erc = parseAbi(["function balanceOf(address) view returns (uint256)"]);
const uniQuoter = parseAbi(["function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96)) returns (uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)"]);
const UNI_QUOTER = "0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a" as Hex;

const report: any = { checkedAt: new Date().toISOString(), targets: [] };
const mainClient = makeClient();

async function directRead(c: PublicClient, pool: Hex, block: bigint) {
  const [s, liq, t0, bal, fee] = await Promise.all([
    c.readContract({ address: pool, abi: poolAbi, functionName: "slot0", blockNumber: block }),
    c.readContract({ address: pool, abi: poolAbi, functionName: "liquidity", blockNumber: block }),
    c.readContract({ address: pool, abi: poolAbi, functionName: "token0", blockNumber: block }),
    c.readContract({ address: USDC, abi: erc, functionName: "balanceOf", args: [pool], blockNumber: block }),
    c.readContract({ address: pool, abi: poolAbi, functionName: "fee", blockNumber: block }),
  ]);
  return { sqrtPriceX96: String((s as any)[0]), tick: Number((s as any)[1]), liquidity: String(liq), token0: (t0 as string).toLowerCase(), usdcBalance: String(bal), fee: Number(fee) };
}

/** Exact price (USDC per token, 6 decimals) from slot0 using integer arithmetic only. */
function exactPriceMicro(sqrt: bigint, tokenIsToken0: boolean, tokenDecimals: number): bigint {
  const Q192 = 1n << 192n;
  const sq = sqrt * sqrt;
  const scale = 10n ** BigInt(tokenDecimals - 6) * 1_000_000n;
  return tokenIsToken0 ? (sq * scale) / Q192 : (Q192 * scale) / sq;
}

const TARGETS: { symbol: string; venue: PoolRead["venue"] }[] = [
  { symbol: "AAPLc", venue: "aerodrome-slipstream" },
  { symbol: "CRCLc", venue: "aerodrome-slipstream" },
  { symbol: "AAPLc", venue: "uniswap-v3" },
];

for (const tg of TARGETS) {
  const t = list.find((x) => x.symbol === tg.symbol)!;
  const found = await discoverPools(mainClient, [t]);
  const { pools, block } = await readPools(mainClient, t, found.get(t.address) ?? []);
  const pool = pools.filter((p) => p.venue === tg.venue).sort((a, b) => b.usdcDepth - a.usdcDepth)[0];
  if (!pool) { console.log(tg, "no pool"); continue; }
  const out: any = { symbol: tg.symbol, venue: VENUE_LABEL[pool.venue], pool: pool.pool, factory: pool.factory, block: String(block), assay: { price: pool.spotPrice, tick: pool.tick, liquidity: String(pool.liquidity), usdcDepth: pool.usdcDepth, feeBps: pool.feeBps, costToMove1pctUsd: pool.costToMove100bpsUsd, ticksRead: pool.ticks?.length } };

  // A. same block, separate providers, direct contract calls
  out.rpc = {};
  for (const r of RPCS) {
    try { out.rpc[r.name] = await directRead(mk(r.url), pool.pool, block); }
    catch (e: any) { out.rpc[r.name] = { error: (e.shortMessage ?? e.message).slice(0, 80) }; }
  }
  const okReads = Object.entries(out.rpc).filter(([, v]: any) => !v.error) as [string, any][];
  const ref = okReads[0]?.[1];
  out.providersAnswered = okReads.map(([n]) => n);
  out.providersIdentical = okReads.length >= 2 && okReads.every(([, v]) => JSON.stringify(v) === JSON.stringify(ref));
  out.matchesAssayStoredState = !!ref && ref.sqrtPriceX96 === String(pool.sqrtPriceX96) && ref.liquidity === String(pool.liquidity) && Number(ref.usdcBalance) / 1e6 === pool.usdcDepth && ref.tick === pool.tick;

  // B. exact integer price vs Assay float price
  if (ref) {
    const exact = exactPriceMicro(BigInt(ref.sqrtPriceX96), ref.token0 === t.address.toLowerCase(), t.decimals);
    const assayPrice = v3Price(BigInt(ref.sqrtPriceX96), ref.token0 === t.address.toLowerCase(), t.decimals);
    out.exactPrice = { integerMath: Number(exact) / 1e6, assayFloat: assayPrice, relDiff: Math.abs(Number(exact) / 1e6 - assayPrice) / assayPrice };
  }

  // C. DEX's own quoter vs Assay's tick walk (Uniswap v3 QuoterV2)
  if (pool.venue === "uniswap-v3" && pool.feeBps != null) {
    out.quoter = [];
    const fee = Math.round(pool.feeBps * 100);
    for (const usd of [1000, 5000, 20000]) {
      try {
        const amountIn = BigInt(usd) * 1_000_000n;
        const sim = await mainClient.simulateContract({ address: UNI_QUOTER, abi: uniQuoter, functionName: "quoteExactInputSingle", args: [{ tokenIn: USDC, tokenOut: t.address, amountIn, fee, sqrtPriceLimitX96: 0n }], blockNumber: block } as any);
        const res = sim.result as readonly [bigint, bigint, number, bigint];
        const stockOutQuoter = Number(res[0]) / 10 ** t.decimals;
        const mine = quoteImpact(pool, t.decimals, usd, "buy");
        // Quoter effective price vs spot -> slippage bps, same definition as Assay (fee included)
        const quoterSlip = (usd / stockOutQuoter / pool.spotPrice - 1) * 1e4;
        out.quoter.push({ usd, quoterStockOut: stockOutQuoter, quoterSlippageBps: quoterSlip, quoterTicksCrossed: Number(res[2]), assaySlippageBps: mine.slippageBps, assayTicksCrossed: mine.ticksCrossed, assayLowerBound: mine.lowerBound, diffBps: mine.slippageBps != null ? mine.slippageBps - quoterSlip : null });
      } catch (e: any) { out.quoter.push({ usd, error: (e.shortMessage ?? e.message).slice(0, 100) }); }
    }
  }
  report.targets.push(out);
  console.log(JSON.stringify(out, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 1));
}
fs.writeFileSync("fixtures/verification.json", JSON.stringify(report, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2));
