import { describe, expect, it } from "vitest";
import { costToMoveUsd, v3Impact, v3Price, vetPool, THRESHOLDS, type PoolRead } from "../src/index.js";

const sqrtFor = (price: number, tokenIsToken0: boolean) => {
  // token (8 dec) vs USDC (6 dec)
  const raw = tokenIsToken0 ? (price * 1e6) / 1e8 : 1e8 / (price * 1e6);
  return BigInt(Math.floor(Math.sqrt(raw) * 2 ** 96));
};

describe("cost to move the price (manipulation cost)", () => {
  for (const tokenIsToken0 of [true, false]) {
    it(`matches the swap simulation, token is token${tokenIsToken0 ? 0 : 1}`, () => {
      const sqrtPriceX96 = sqrtFor(350, tokenIsToken0);
      const tick = Math.floor(Math.log((Number(sqrtPriceX96) / 2 ** 96) ** 2) / Math.log(1.0001));
      const base = { sqrtPriceX96, liquidity: 500_000_000_000n, tick, tickSpacing: 60, tokenIsToken0, tokenDecimals: 8 };
      const wide = { ...base, tickLower: tick - 20_000, tickUpper: tick + 20_000 };
      const c = costToMoveUsd({ ...wide, bps: 100 })!;
      expect(c.usd).toBeGreaterThan(0);
      expect(c.rangeLimited).toBe(false);
      const p0 = v3Price(sqrtPriceX96, tokenIsToken0, 8);
      const moves = (["buy", "sell"] as const).map((side) => {
        const r = v3Impact({ ...wide, feeBps: 0, usdc: c.usd, side })!;
        return Math.abs(r.endPrice / p0 - 1);
      });
      // spending the computed cost on the cheaper side moves the price by about 1%
      expect(Math.min(...moves.map((m) => Math.abs(m - 0.01)))).toBeLessThan(0.0015);
    });
  }
  it("is flagged range-limited when liquidity ends first, and scales with liquidity", () => {
    const sqrtPriceX96 = sqrtFor(350, true);
    const tick = Math.floor(Math.log((Number(sqrtPriceX96) / 2 ** 96) ** 2) / Math.log(1.0001));
    const narrow = costToMoveUsd({ sqrtPriceX96, liquidity: 1_000_000_000n, tick, tickSpacing: 60, tickLower: tick - 10, tickUpper: tick + 10, tokenIsToken0: true, tokenDecimals: 8, bps: 100 })!;
    expect(narrow.rangeLimited).toBe(true);
    const a = costToMoveUsd({ sqrtPriceX96, liquidity: 1_000_000_000n, tick, tickSpacing: 60, tickLower: tick - 5000, tickUpper: tick + 5000, tokenIsToken0: true, tokenDecimals: 8, bps: 100 })!;
    const b = costToMoveUsd({ sqrtPriceX96, liquidity: 10_000_000_000n, tick, tickSpacing: 60, tickLower: tick - 5000, tickUpper: tick + 5000, tokenIsToken0: true, tokenDecimals: 8, bps: 100 })!;
    expect(b.usd / a.usd).toBeCloseTo(10, 5);
  });
  it("returns null with no liquidity", () => {
    expect(costToMoveUsd({ sqrtPriceX96: 1n << 96n, liquidity: 0n, tick: 0, tickSpacing: 60, tokenIsToken0: true, tokenDecimals: 8, bps: 100 })).toBeNull();
  });
});

describe("vetPool uses the manipulation cost", () => {
  const pool = (over: Partial<PoolRead>): PoolRead => ({ venue: "uniswap-v3", pool: "0x0000000000000000000000000000000000000001", spotPrice: 100, usdcDepth: 50_000, liquidity: 1n, twapPrice: null, ...over });
  it("rejects a deep-looking pool whose active range is cheap to move", () => {
    const v = vetPool(pool({ costToMove100bpsUsd: THRESHOLDS.minCostToMove100bpsUsd - 1 }));
    expect(v.ok).toBe(false);
    expect(v.why).toMatch(/too cheap to manipulate/);
  });
  it("accepts when the cost is high enough", () => {
    expect(vetPool(pool({ costToMove100bpsUsd: 5000 })).ok).toBe(true);
  });
});
