// Compare the old single-range lower bound with the real multi-tick manipulation cost, per pool.
import fs from "node:fs";
import { makeClient, discoverPools, readPools, toTokenRef, costToMoveUsd, type ApiToken } from "../src/index.js";

const list = (JSON.parse(fs.readFileSync("fixtures/tokenized-stocks.list.json", "utf8")).tokens as ApiToken[]).map(toTokenRef);
const syms = process.argv.slice(2);
const toks = list.filter((t) => syms.includes(t.symbol));
const client = makeClient();
const found = await discoverPools(client, toks);
for (const t of toks) {
  const { pools } = await readPools(client, t, found.get(t.address) ?? []);
  for (const p of pools.filter((x) => x.venue !== "aerodrome-v2")) {
    const old =
      p.liquidity && p.liquidity > 0n && p.tickSpacing
        ? costToMoveUsd({ sqrtPriceX96: p.sqrtPriceX96!, liquidity: p.liquidity, tick: p.tick!, tickSpacing: p.tickSpacing, tickLower: p.tickLower, tickUpper: p.tickUpper, tokenIsToken0: !!p.tokenIsToken0, tokenDecimals: t.decimals, bps: 100 })
        : null;
    console.log(
      t.symbol.padEnd(6), p.venue.padEnd(21), p.pool.slice(0, 10), "fee", String(p.feeBps).padEnd(5), "depth $" + String(Math.round(p.usdcDepth)).padEnd(8),
      "ticks", String(p.ticks?.length ?? "-").padEnd(4),
      "OLD single-range $" + (old ? Math.round(old.usd) : "-"), old?.rangeLimited ? "(limited)" : "",
      "| NEW multi-tick $" + (p.costToMove100bpsUsd != null ? Math.round(p.costToMove100bpsUsd) : "-"), p.costRangeLimited ? "(window)" : "",
    );
  }
}
