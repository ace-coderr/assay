// Reads on-chain state for every pool found by recon-coverage.ts and values it in USD.
import fs from "node:fs";
import { createPublicClient, fallback, http, parseAbi, formatUnits } from "viem";
import { base } from "viem/chains";

const client = createPublicClient({
  chain: base,
  transport: fallback([http("https://base-rpc.publicnode.com", { retryCount: 3, retryDelay: 400 }), http("https://mainnet.base.org", { retryCount: 2 })]),
});
const cov = JSON.parse(fs.readFileSync("fixtures/coverage-factories.json", "utf8"));
const list = JSON.parse(fs.readFileSync("fixtures/tokenized-stocks.list.json", "utf8")).tokens as any[];

const QUOTE: Record<string, { addr: `0x${string}`; dec: number }> = {
  USDC: { addr: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", dec: 6 },
  WETH: { addr: "0x4200000000000000000000000000000000000006", dec: 18 },
  USDbC: { addr: "0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA", dec: 6 },
  cbBTC: { addr: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf", dec: 8 },
  AERO: { addr: "0x940181a94A35A4569E4529A3CDfB74e38FD98631", dec: 18 },
};
const v3 = parseAbi([
  "function slot0() view returns (uint160 sqrtPriceX96,int24 tick)",
  "function liquidity() view returns (uint128)",
  "function token0() view returns (address)",
]);
const v2 = parseAbi(["function getReserves() view returns (uint256,uint256,uint256)", "function token0() view returns (address)"]);
const erc = parseAbi(["function balanceOf(address) view returns (uint256)"]);
const getPoolFee = parseAbi(["function getPool(address,address,uint24) view returns (address)"]);

// USD price of each quote asset from the deepest Uniswap v3 quote/USDC pool.
async function usdPrice(q: string): Promise<number> {
  if (q === "USDC") return 1;
  let best = { liq: 0n, price: 0 };
  for (const fee of [100, 500, 3000, 10000]) {
    const pool = (await client.readContract({ address: "0x33128a8fC17869897dcE68Ed026d694621f6FDfD", abi: getPoolFee, functionName: "getPool", args: [QUOTE[q]!.addr, QUOTE.USDC!.addr, fee] }).catch(() => "0x0000000000000000000000000000000000000000")) as `0x${string}`;
    if (/^0x0+$/.test(pool)) continue;
    const [s, l, t0] = await Promise.all([client.readContract({ address: pool, abi: v3, functionName: "slot0" }), client.readContract({ address: pool, abi: v3, functionName: "liquidity" }), client.readContract({ address: pool, abi: v3, functionName: "token0" })]);
    const r = Number((s as any)[0]) / 2 ** 96;
    const raw = r * r; // token1/token0
    const isT0 = (t0 as string).toLowerCase() === QUOTE[q]!.addr.toLowerCase();
    const price = (isT0 ? raw : 1 / raw) * 10 ** (QUOTE[q]!.dec - 6);
    if ((l as bigint) > best.liq) best = { liq: l as bigint, price };
  }
  return best.price;
}
const usd: Record<string, number> = {};
for (const q of ["USDC", "WETH", "cbBTC", "AERO"]) usd[q] = await usdPrice(q);
console.log("quote USD prices", usd);

const rows: any[] = [];
for (const [sym, info] of Object.entries<any>(cov.tokens)) {
  const tok = list.find((t) => t.symbol === sym);
  const ref = tok.nav_price;
  for (const p of info.pools) {
    const q = QUOTE[p.quote]!;
    const isV3 = /V3|Slipstream/.test(p.dex);
    const row: any = { token: sym, dex: p.dex, quote: p.quote, param: p.param, pool: p.pool, reference: ref ?? null };
    try {
      const t0 = (await client.readContract({ address: p.pool, abi: v2, functionName: "token0" })) as string;
      const tokIs0 = t0.toLowerCase() === info.address.toLowerCase();
      if (isV3) {
        const [s, liq] = await Promise.all([client.readContract({ address: p.pool, abi: v3, functionName: "slot0" }), client.readContract({ address: p.pool, abi: v3, functionName: "liquidity" })]);
        const r = Number((s as any)[0]) / 2 ** 96;
        const raw = r * r;
        const inQuote = (tokIs0 ? raw : 1 / raw) * 10 ** (8 - q.dec);
        row.priceUsd = inQuote * (usd[p.quote] ?? NaN);
        row.liquidity = String(liq);
        const qb = (await client.readContract({ address: q.addr, abi: erc, functionName: "balanceOf", args: [p.pool] })) as bigint;
        row.quoteSideUsd = Number(formatUnits(qb, q.dec)) * (usd[p.quote] ?? NaN);
      } else {
        const [rs] = await Promise.all([client.readContract({ address: p.pool, abi: v2, functionName: "getReserves" })]);
        const [r0, r1] = rs as readonly bigint[];
        const tokRes = Number(formatUnits(tokIs0 ? r0! : r1!, 8));
        const quoteRes = Number(formatUnits(tokIs0 ? r1! : r0!, q.dec));
        row.priceUsd = tokRes > 0 ? (quoteRes / tokRes) * (usd[p.quote] ?? NaN) : null;
        row.quoteSideUsd = quoteRes * (usd[p.quote] ?? NaN);
        row.tokenReserve = tokRes;
        // cost to move a constant-product pool 1%: spend quote = quoteRes*(sqrt(1.01)-1)
        row.costToMove1pctUsd = quoteRes * (Math.sqrt(1.01) - 1) * (usd[p.quote] ?? NaN);
      }
      row.devVsRefPct = ref && row.priceUsd ? ((row.priceUsd - ref) / ref) * 100 : null;
    } catch (e: any) {
      row.error = (e.shortMessage ?? e.message).slice(0, 90);
    }
    rows.push(row);
    console.log(
      sym.padEnd(6), p.dex.padEnd(16), p.quote.padEnd(5), String(p.param ?? "").padEnd(5),
      row.error ? "ERR " + row.error : `px $${row.priceUsd?.toFixed(2)} vsRef ${row.devVsRefPct?.toFixed(1)}% quoteSide $${Math.round(row.quoteSideUsd)} liq ${row.liquidity ?? "-"} move1% ${row.costToMove1pctUsd != null ? "$" + Math.round(row.costToMove1pctUsd) : "-"}`,
    );
  }
}
fs.writeFileSync("fixtures/coverage-pool-state.json", JSON.stringify({ checkedAt: new Date().toISOString(), usdPrices: usd, rows }, null, 2));
