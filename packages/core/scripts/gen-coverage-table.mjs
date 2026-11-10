// Prints the per-token coverage table (markdown) from a running API and the coverage fixtures.
import fs from "node:fs";
const base = process.argv[2] ?? "http://127.0.0.1:8899";
const board = await (await fetch(`${base}/api/board`)).json();
const ds = JSON.parse(fs.readFileSync("fixtures/coverage-dexscreener.json", "utf8")).tokens;
const v4 = JSON.parse(fs.readFileSync("fixtures/coverage-v4.json", "utf8")).pools;
const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const fmt = (n) => "$" + Math.round(n).toLocaleString("en-US");
console.log(`Generated ${new Date().toISOString()} from ${base} (block ${board.block}).\n`);
console.log("| Token | State | Pool used | Pool USDC | Cost to move 1% | Pools read / rejected | v4 USDC pools with liquidity |");
console.log("| --- | --- | --- | --- | --- | --- | --- |");
for (const r of board.readings) {
  const p = r.poolUsed;
  const scanned = ["TSLAc", "GOOGLc", "SNDKc", "MSTRc", "SPCXc", "CRCLc", "INTCc"].includes(r.symbol);
  const v4n = !scanned ? "not scanned" : v4.filter((x) => x.token === r.symbol && (x.currency0.toLowerCase() === USDC || x.currency1.toLowerCase() === USDC) && x.state && x.state.liquidity !== "0").length;
  void ds;
  console.log(
    `| ${r.symbol} | ${r.status === "ok" ? r.state : "unavailable"} | ${p ? `${p.venue === "aerodrome-slipstream" ? "Aerodrome Slipstream" : p.venue} \`${p.pool.slice(0, 10)}…${p.pool.slice(-4)}\`` : "-"} | ${p ? fmt(p.usdcDepth) : "-"} | ${p?.costToMove100bpsUsd != null ? fmt(p.costToMove100bpsUsd) : "-"} | ${r.poolsConsidered - r.poolsRejected.length} / ${r.poolsRejected.length} | ${v4n} |`,
  );
}
