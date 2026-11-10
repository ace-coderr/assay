// For every non-v4 USDC/WETH/cbBTC pool DexScreener lists for the 7 tokens, read the pool from chain and group by factory.
import fs from "node:fs";
import { createPublicClient, fallback, http, parseAbi, formatUnits, type Hex } from "viem";
import { base } from "viem/chains";

const client = createPublicClient({ chain: base, transport: fallback([http("https://base-rpc.publicnode.com", { retryCount: 3, retryDelay: 400 }), http("https://mainnet.base.org", { retryCount: 2 })]) });
const ds = JSON.parse(fs.readFileSync("fixtures/coverage-dexscreener.json", "utf8")).tokens as Record<string, any[]>;
const list = JSON.parse(fs.readFileSync("fixtures/tokenized-stocks.list.json", "utf8")).tokens as any[];
const abi = parseAbi([
  "function token0() view returns (address)", "function token1() view returns (address)", "function factory() view returns (address)",
  "function fee() view returns (uint24)", "function tickSpacing() view returns (int24)", "function liquidity() view returns (uint128)",
  "function slot0() view returns (uint160,int24)", "function getReserves() view returns (uint256,uint256,uint256)", "function stable() view returns (bool)",
  "function symbol() view returns (string)", "function decimals() view returns (uint8)", "function balanceOf(address) view returns (uint256)",
]);
const call = async (address: Hex, fn: string, args: any[] = []) => { try { return await client.readContract({ address, abi, functionName: fn, args } as never); } catch { return null; } };
const QUOTES = new Set(["USDC", "WETH", "cbBTC"]);
const rows: any[] = [];
for (const [sym, pairs] of Object.entries(ds)) {
  const tok = list.find((t) => t.symbol === sym);
  for (const p of pairs) {
    if (p.pair.length !== 42 || !QUOTES.has(p.quote) || p.liquidityUsd < 5000) continue; // non-v4, major quote, non-trivial
    const a = p.pair as Hex;
    const [t0, t1, factory, fee, ts, liq, stable] = await Promise.all(["token0", "token1", "factory", "fee", "tickSpacing", "liquidity", "stable"].map((f) => call(a, f)));
    const row = { token: sym, ds: p.dexId, quote: p.quote, pool: a, factory, token0: t0, fee: fee == null ? null : Number(fee), tickSpacing: ts == null ? null : Number(ts), liquidity: liq == null ? null : String(liq), stable, dsLiqUsd: Math.round(p.liquidityUsd), isStockToken0: t0 ? (t0 as string).toLowerCase() === tok.contract_address.toLowerCase() : null };
    rows.push(row);
    console.log(sym.padEnd(6), String(p.dexId).padEnd(11), p.quote.padEnd(5), a, "factory", String(factory).slice(0, 10), "ts", row.tickSpacing, "fee", row.fee, "stable", stable, "liq$", row.dsLiqUsd);
  }
}
const byFactory: Record<string, number> = {};
for (const r of rows) byFactory[`${r.ds} ${r.factory}`] = (byFactory[`${r.ds} ${r.factory}`] ?? 0) + 1;
console.log(byFactory);
fs.writeFileSync("fixtures/coverage-identified2.json", JSON.stringify({ checkedAt: new Date().toISOString(), rows, byFactory }, null, 2));
