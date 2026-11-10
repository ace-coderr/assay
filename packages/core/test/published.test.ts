import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { buildReading, check, findReading, probe, toTokenRef, VERDICT_MAX_AGE_SEC, type ApiToken, type LatestDoc, type PoolRead } from "../src/index.js";

const fx = (f: string) => fs.readFileSync(path.resolve(__dirname, "../../../fixtures", f), "utf8");
const list = (JSON.parse(fx("tokenized-stocks.list.json")).tokens as ApiToken[]).map(toTokenRef);

function doc(): LatestDoc {
  const ref = list.filter((t) => t.navPrice != null);
  const now = new Date().toISOString();
  const raw = (350 * 1e6) / 1e8;
  const sqrtPriceX96 = BigInt(Math.floor(Math.sqrt(raw) * 2 ** 96)).toString();
  const tick = Math.floor(Math.log(raw) / Math.log(1.0001));
  const lo = Math.floor(tick / 60) * 60;
  const readings = ref.map((t) => buildReading({ token: t, pools: [], now: new Date(Date.parse(t.navUpdatedAt!) + 3600_000) }));
  readings.push({
    symbol: "TESTc", address: "0x0000000000000000000000000000000000000001", status: "ok", state: "Fresh", reasons: [], multiplier: 1,
    dexPrice: 350, reference: 350, deviationBps: 0, poolsConsidered: 1, poolsRejected: [], readAt: now,
    poolUsed: { venue: "uniswap-v3", pool: "0x0000000000000000000000000000000000000002", feeBps: 30, spotPrice: 350, usdcDepth: 20000, liquidity: "20000000000", sqrtPriceX96, tick, tickSpacing: 60, tickLower: lo, tickUpper: lo + 60, tokenIsToken0: true } as unknown as PoolRead,
  });
  return { updatedAt: now, sources: { tokensApi: { ok: true, at: now }, rpc: { ok: true, at: now } }, untracked: 1, totalTokens: 13, untrackedTokens: [{ symbol: "AMDc", multiplier: 1 }], readings };
}

describe("shared read-side logic (used by the site and the MCP server)", () => {
  it("a token with no pool is an explained 'unavailable', code no-pool", () => {
    const r = findReading(doc(), "CRCLc")!;
    expect(r.status).toBe("unavailable");
    const p = probe(r, "CRCLc", 1000, "buy");
    expect(p.ok).toBe(false);
    expect(p).toMatchObject({ status: "unavailable", code: "no-pool" });
  });
  it("a real token with no reference value is explained, not 'unknown'", () => {
    const r = findReading(doc(), "amd")!;
    expect(r.unavailableCode).toBe("no-reference");
    expect(r.dexPrice).toBeUndefined();
  });
  it("a symbol that does not exist is unknown", () => {
    expect(findReading(doc(), "ZZZZ")).toBeUndefined();
    expect(probe(undefined, "ZZZZ", 10, "buy")).toMatchObject({ ok: false, status: "unknown" });
  });
  it("labels a small size ESTIMATE and a size beyond the read liquidity AT_LEAST with an explanation", () => {
    const r = findReading(doc(), "TESTc");
    const small = probe(r, "TESTc", 10, "buy");
    const big = probe(r, "TESTc", 500_000, "buy");
    expect(small.ok && small.label).toBe("ESTIMATE");
    expect(big.ok && big.label).toBe("AT_LEAST");
    expect(big.ok && big.explanation).toMatch(/^At least:/);
  });
  it("check returns a read-only verdict and refuses a reading that is too old", () => {
    const r = findReading(doc(), "TESTc");
    const fresh = check(r, "TESTc", 100, "buy", 60);
    expect(fresh.readOnly).toBe(true);
    expect(["ok", "caution", "avoid"]).toContain(fresh.verdict);
    expect(check(r, "TESTc", 100, "buy", VERDICT_MAX_AGE_SEC + 60).verdict).toBe("unknown");
  });
});
