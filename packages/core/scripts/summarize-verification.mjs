import fs from "node:fs";
const j = JSON.parse(fs.readFileSync("fixtures/verification.json", "utf8"));
for (const t of j.targets) {
  console.log(`${t.symbol} ${t.venue} ${t.pool} block ${t.block}`);
  console.log("  providers that answered:", t.providersAnswered.join(", "), "| identical at the pinned block:", t.providersIdentical, "| match Assay's stored state:", t.matchesAssayStoredState);
  console.log("  price: integer math", t.exactPrice?.integerMath, "vs Assay float", t.exactPrice?.assayFloat, "rel diff", t.exactPrice?.relDiff.toExponential(2));
  console.log("  Assay: depth $" + Math.round(t.assay.usdcDepth), "cost to move 1% $" + Math.round(t.assay.costToMove1pctUsd), "ticks read", t.assay.ticksRead, "fee bps", t.assay.feeBps);
  for (const q of t.quoter ?? []) console.log("  quoter", "$" + q.usd, q.error ? q.error : `quoter ${q.quoterSlippageBps.toFixed(4)} bps | assay ${q.assaySlippageBps.toFixed(4)} bps${q.assayLowerBound ? " (AT LEAST)" : ""} | diff ${q.diffBps.toFixed(4)}`);
}
