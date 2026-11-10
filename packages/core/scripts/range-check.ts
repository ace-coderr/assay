import fs from "node:fs";
import { makeClient, discoverPools, readPools, toTokenRef, quoteImpact, type ApiToken } from "../src/index.js";

const list = (JSON.parse(fs.readFileSync("fixtures/tokenized-stocks.list.json", "utf8")).tokens as ApiToken[]).map(toTokenRef);
const t = list.find((x) => x.symbol === "AAPLc")!;
const client = makeClient();
const found = await discoverPools(client, [t]);
const { pools } = await readPools(client, t, found.get(t.address) ?? []);
for (const p of pools.filter((x) => x.venue === "uniswap-v3" && (x.liquidity ?? 0n) > 0n)) {
  console.log("pool", p.pool, "tick", p.tick, "spacing", p.tickSpacing, "range", p.tickLower, p.tickUpper, "depth", p.usdcDepth.toFixed(0));
  for (const usd of [100, 1000, 5000, 20000]) {
    for (const side of ["buy", "sell"] as const) {
      const q = quoteImpact(p, 8, usd, side);
      console.log("  ", side, usd, q.slippageBps?.toFixed(1), q.lowerBound ? "(lower bound)" : "");
    }
  }
}
