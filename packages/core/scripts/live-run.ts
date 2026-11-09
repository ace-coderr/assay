import fs from "node:fs";
import { makeClient, discoverPools, readPools, buildReading, toTokenRef, type ApiToken } from "../src/index.js";

const list = (JSON.parse(fs.readFileSync("fixtures/tokenized-stocks.list.json", "utf8")).tokens as ApiToken[])
  .map(toTokenRef)
  .filter((t) => t.navPrice != null);
const client = makeClient();
const found = await discoverPools(client, list);
for (const t of list) {
  const { pools, block } = await readPools(client, t, found.get(t.address) ?? []);
  const r = buildReading({ token: t, pools, now: new Date(), block: String(block) });
  const line =
    r.status === "ok"
      ? [
          String(r.state).padEnd(9),
          "dex", r.dexPrice!.toFixed(3),
          "ref", r.reference,
          "dev", r.deviationBps!.toFixed(0) + "bps",
          "depth $" + r.poolUsed!.usdcDepth.toFixed(0),
          "twap", r.poolUsed!.twapPrice?.toFixed(3) ?? "n/a",
        ].join(" ")
      : "unavailable: " + r.unavailableReason;
  console.log(t.symbol.padEnd(7), line, "| rejected", r.poolsRejected.length, "/", r.poolsConsidered);
  console.log("        ", r.reasons.join("; "), JSON.stringify(r.poolsRejected.map((p) => p.pool.slice(0, 8) + " " + p.why)));
}
