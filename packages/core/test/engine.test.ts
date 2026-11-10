import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { buildReading, classify, vetPool, THRESHOLDS, v3Price, v3Impact, toTokenRef, deviationBps, type PoolRead, type ApiToken } from "../src/index.js";

// Fixtures were captured from live calls (see docs/data-sources.md).
const fx = (f: string) => fs.readFileSync(path.resolve(__dirname, "../../../fixtures", f), "utf8");
const list = (JSON.parse(fx("tokenized-stocks.list.json")).tokens as ApiToken[]).map(toTokenRef);
const poolRows = fx("pool-reads.jsonl").trim().split("\n").map((l) => JSON.parse(l));

const tok = (s: string) => list.find((t) => t.symbol === s)!;
const poolsFor = (s: string): PoolRead[] =>
  poolRows
    .filter((r) => r.sym === s)
    .map((r) => ({
      venue: "uniswap-v3" as const,
      pool: r.pool,
      feeBps: Number(r.fee) / 100,
      spotPrice: r.rpc0.price,
      usdcDepth: r.rpc0.usdcDepth,
      liquidity: BigInt(r.rpc0.liq),
      twapPrice: null,
    }));
const at = (iso: string, plusHours: number) => new Date(Date.parse(iso) + plusHours * 3600_000);

describe("fixtures", () => {
  it("contain the live token list and pool reads", () => {
    expect(list.length).toBe(318);
    expect(list.filter((t) => t.navPrice != null).length).toBe(12);
    expect(poolRows.length).toBeGreaterThan(20);
  });
  it("two RPCs agreed on every captured pool", () => {
    for (const r of poolRows) expect(r.rpc0.price).toBe(r.rpc1.price);
  });
});

describe("pool guard (real pools)", () => {
  it("rejects every captured pool with zero in-range liquidity, including absurd prices", () => {
    const zero = poolRows.filter((r) => r.rpc0.liq === "0");
    expect(zero.length).toBeGreaterThan(5);
    for (const r of zero) {
      const v = vetPool({ venue: "uniswap-v3", pool: r.pool, spotPrice: r.rpc0.price, usdcDepth: r.rpc0.usdcDepth, liquidity: 0n });
      expect(v.ok).toBe(false);
    }
    // METAc 0.01% pool reported 5000.41 against a ~643 reference: must never be used
    const meta = poolsFor("METAc").find((p) => p.spotPrice > 4000)!;
    expect(vetPool(meta).ok).toBe(false);
  });
  it("rejects thin pools even when liquidity is non-zero", () => {
    const sndkThin = poolsFor("SNDKc").find((p) => p.usdcDepth > 1 && p.usdcDepth < 100)!;
    expect(vetPool(sndkThin).ok).toBe(false);
  });
  it("accepts a deep pool", () => {
    const aapl = poolsFor("AAPLc").find((p) => p.usdcDepth > 20000)!;
    expect(vetPool(aapl).ok).toBe(true);
  });
});

describe("buildReading on live data", () => {
  const aapl = tok("AAPLc");
  it("AAPLc is Fresh shortly after the reference update", () => {
    const r = buildReading({ token: aapl, pools: poolsFor("AAPLc"), now: at(aapl.navUpdatedAt!, 1) });
    expect(r.status).toBe("ok");
    expect(r.state).toBe("Fresh");
    expect(r.poolUsed!.usdcDepth).toBeGreaterThan(20000);
    expect(Math.abs(r.deviationBps!)).toBeLessThan(THRESHOLDS.driftBps);
  });
  it("is Stale when the reference is frozen for a weekend", () => {
    const r = buildReading({ token: aapl, pools: poolsFor("AAPLc"), now: at(aapl.navUpdatedAt!, 60) });
    expect(r.state).toBe("Stale");
  });
  it("is unavailable, not guessed, when no pool exists", () => {
    const crcl = tok("CRCLc");
    const r = buildReading({ token: crcl, pools: [], now: at(crcl.navUpdatedAt!, 1) });
    expect(r.status).toBe("unavailable");
    expect(r.state).toBeUndefined();
    expect(r.dexPrice).toBeUndefined();
  });
  it("is unavailable when there is no reference value", () => {
    const amd = tok("AMDc");
    const r = buildReading({ token: amd, pools: [], now: new Date() });
    expect(r.status).toBe("unavailable");
    expect(r.unavailableReason).toMatch(/no reference/);
  });
  it("does not multiply the reference by the multiplier again", () => {
    const nvda = tok("NVDAc");
    const r = buildReading({ token: nvda, pools: poolsFor("NVDAc"), now: at(nvda.navUpdatedAt!, 1) });
    expect(r.reference).toBe(nvda.navPrice);
    expect(r.underlyingPrice).toBeCloseTo(nvda.navPrice! / nvda.multiplier, 9);
    expect(r.underlyingPrice).toBeLessThan(r.reference!);
  });
  it("flags a multiplier change as Broken", () => {
    const nvda = tok("NVDAc");
    const r = buildReading({ token: nvda, pools: poolsFor("NVDAc"), now: at(nvda.navUpdatedAt!, 1), previousMultiplier: 1 });
    expect(r.state).toBe("Broken");
  });
  it("covers every reference token without throwing", () => {
    for (const t of list.filter((x) => x.navPrice != null)) {
      const r = buildReading({ token: t, pools: poolsFor(t.symbol), now: at(t.navUpdatedAt!, 1) });
      expect(["ok", "unavailable"]).toContain(r.status);
    }
  });
});

describe("classify thresholds", () => {
  const base = { reference: 100, referenceAgeSec: 3600 };
  it.each([
    [100.5, "Fresh"],
    [101.5, "Drifting"],
    [98.0, "Drifting"],
    [106, "Broken"],
    [90, "Broken"],
  ])("dex %f -> %s", (dex, state) => {
    expect(classify({ ...base, dexPrice: dex }).state).toBe(state);
  });
  it("stale beats drift", () => {
    expect(classify({ dexPrice: 120, reference: 100, referenceAgeSec: 27 * 3600 }).state).toBe("Stale");
  });
  it("TWAP divergence is Broken even when spot matches the reference", () => {
    expect(classify({ ...base, dexPrice: 100, twapDivergenceBps: 500 }).state).toBe("Broken");
  });
  it("pool disagreement is Broken", () => {
    expect(classify({ ...base, dexPrice: 100, poolDisagreementBps: 400 }).state).toBe("Broken");
  });
});

describe("math", () => {
  it("v3Price inverts correctly for both token orderings", () => {
    // token0 = stock (8 dec), token1 = USDC (6 dec): price 350 USDC => raw = 350e6/1e8
    const raw = (350 * 1e6) / 1e8;
    const sqrt = BigInt(Math.floor(Math.sqrt(raw) * 2 ** 96));
    expect(v3Price(sqrt, true, 8)).toBeCloseTo(350, 3);
    // token0 = USDC, token1 = stock: raw = stock/usdc = 1e8/(350e6)
    const raw2 = 1e8 / (350 * 1e6);
    const sqrt2 = BigInt(Math.floor(Math.sqrt(raw2) * 2 ** 96));
    expect(v3Price(sqrt2, false, 8)).toBeCloseTo(350, 3);
  });
  it("impact grows with size and is worse in thinner pools", () => {
    const raw = (350 * 1e6) / 1e8;
    const sqrtPriceX96 = BigInt(Math.floor(Math.sqrt(raw) * 2 ** 96));
    const mk = (L: bigint, usdc: number) =>
      v3Impact({ sqrtPriceX96, liquidity: L, tick: 0, tickSpacing: 60, tokenIsToken0: true, tokenDecimals: 8, feeBps: 30, usdc, side: "buy" })!;
    const small = mk(400_000_000_000n, 100);
    const big = mk(400_000_000_000n, 10_000);
    const thin = mk(4_000_000_000n, 10_000);
    expect(big.slippageBps).toBeGreaterThan(small.slippageBps);
    expect(thin.slippageBps).toBeGreaterThan(big.slippageBps);
    expect(small.slippageBps).toBeGreaterThanOrEqual(30);
  });
  it("deviationBps sign", () => {
    expect(deviationBps(101, 100)).toBeCloseTo(100, 6);
    expect(deviationBps(99, 100)).toBeCloseTo(-100, 6);
  });
});

import { verdictFor, quoteImpact, v2Impact } from "../src/index.js";

describe("verdict (read-only)", () => {
  const aapl = tok("AAPLc");
  const now = at(aapl.navUpdatedAt!, 1);
  const fresh = buildReading({ token: aapl, pools: poolsFor("AAPLc"), now });
  it("never executes: result is flagged readOnly with a disclaimer", () => {
    const v = verdictFor(fresh, undefined, 10);
    expect(v.readOnly).toBe(true);
    expect(v.disclaimer).toMatch(/Not financial advice/);
  });
  it("ok for a fresh reading", () => expect(verdictFor(fresh, undefined, 10).verdict).toBe("ok"));
  it("unknown when our reading is old", () => expect(verdictFor(fresh, undefined, 3600).verdict).toBe("unknown"));
  it("unknown for an unavailable reading", () => {
    const r = buildReading({ token: tok("CRCLc"), pools: [], now });
    expect(verdictFor(r, undefined, 10).verdict).toBe("unknown");
  });
  it("caution for stale, avoid for broken", () => {
    const stale = buildReading({ token: aapl, pools: poolsFor("AAPLc"), now: at(aapl.navUpdatedAt!, 60) });
    expect(verdictFor(stale, undefined, 10).verdict).toBe("caution");
    const broken = buildReading({ token: aapl, pools: poolsFor("AAPLc"), now, previousMultiplier: 2 });
    expect(verdictFor(broken, undefined, 10).verdict).toBe("avoid");
  });
  it("v2 impact grows with size", () => {
    const a = v2Impact(10_000, 30, 100, "buy").slippageBps;
    const b = v2Impact(10_000, 30, 5_000, "buy").slippageBps;
    expect(b).toBeGreaterThan(a);
    expect(a).toBeGreaterThanOrEqual(30);
  });
  it("quoteImpact on a real v3-shaped pool without state returns null instead of guessing", () => {
    const p = poolsFor("AAPLc")[1]!;
    expect(quoteImpact(p, 8, 1000, "buy").slippageBps).toBeNull();
  });
});
