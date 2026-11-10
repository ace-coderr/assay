// Prints the live board from the deployed API (read-only).
const base = process.argv[2] ?? "https://assay-onbase.netlify.app";
const j = await (await fetch(`${base}/api/board`)).json();
console.log("updated", j.updatedAt, "age", j.ageSec + "s", "block", j.block);
for (const r of j.readings) {
  if (r.status === "ok") {
    const p = r.poolUsed;
    console.log(r.symbol.padEnd(7), String(r.state).padEnd(9), r.deviationBps.toFixed(0).padStart(5) + "bps", "refAge", (r.referenceAgeSec / 3600).toFixed(1) + "h", "depth $" + Math.round(p.usdcDepth), "move1% $" + (p.costToMove100bpsUsd != null ? Math.round(p.costToMove100bpsUsd) : "n/a"));
  } else {
    console.log(r.symbol.padEnd(7), "unavailable:", r.unavailableReason, "|", r.poolsRejected.map((x) => x.why).join("; ").slice(0, 120));
  }
}
