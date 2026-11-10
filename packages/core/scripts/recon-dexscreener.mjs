// Discovery cross-check only: list every Base pair DexScreener knows for the 7 missing tokens.
// Prices and liquidity here are NOT used by Assay; every pool is re-verified on-chain.
import fs from "node:fs";
const list = JSON.parse(fs.readFileSync("fixtures/tokenized-stocks.list.json", "utf8")).tokens;
const MISSING = ["TSLAc", "GOOGLc", "SNDKc", "MSTRc", "SPCXc", "CRCLc", "INTCc"];
const out = {};
for (const sym of MISSING) {
  const t = list.find((x) => x.symbol === sym);
  const r = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${t.contract_address}`);
  const j = await r.json();
  const pairs = (j.pairs ?? []).filter((p) => p.chainId === "base");
  out[sym] = pairs.map((p) => ({ dexId: p.dexId, labels: p.labels ?? [], pair: p.pairAddress, quote: p.quoteToken.symbol, quoteAddr: p.quoteToken.address, priceUsd: p.priceUsd, liquidityUsd: p.liquidity?.usd ?? null, volume24h: p.volume?.h24 ?? null }));
  console.log(sym.padEnd(6), "ref", t.nav_price, "|", pairs.length, "pairs");
  for (const p of out[sym]) console.log("   ", p.dexId.padEnd(12), (p.labels.join(",") || "-").padEnd(8), p.quote.padEnd(6), p.pair, "px", p.priceUsd, "liq$", Math.round(p.liquidityUsd ?? 0), "vol24h$", Math.round(p.volume24h ?? 0));
  await new Promise((r) => setTimeout(r, 400));
}
fs.writeFileSync("fixtures/coverage-dexscreener.json", JSON.stringify({ capturedAt: new Date().toISOString(), note: "discovery only, not a price source", tokens: out }, null, 2));
