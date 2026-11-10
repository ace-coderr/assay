// Summarize recon-v4 console output (or fixtures/coverage-v4.json when complete): per token, v4 pools paired with USDC.
import fs from "node:fs";
const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const src = process.argv[2];
const per = {};
const add = (token, c0, c1, liq) => {
  const usdc = c0.toLowerCase() === USDC || c1.toLowerCase() === USDC;
  const e = (per[token] ??= { events: 0, usdcPairs: 0, usdcPairsWithLiquidity: 0 });
  e.events++;
  if (usdc) { e.usdcPairs++; if (liq && liq !== "0") e.usdcPairsWithLiquidity++; }
};
if (src && fs.existsSync(src) && src.endsWith(".json")) {
  for (const p of JSON.parse(fs.readFileSync(src, "utf8")).pools) add(p.token, p.currency0, p.currency1, p.state?.liquidity);
} else {
  for (const line of fs.readFileSync(src, "utf8").split("\n")) {
    const m = line.match(/^(\w+c)\s+0x[0-9a-f]+\s+(0x[0-9a-f]{40})\s+(0x[0-9a-f]{40})\s+(\{.*\})?/i);
    if (!m) continue;
    let liq;
    try { liq = JSON.parse(m[4]).liquidity; } catch { liq = undefined; }
    add(m[1], m[2], m[3], liq);
  }
}
console.log(JSON.stringify(per, null, 1));
