import { describe, expect, it } from "vitest";
import { manipulationCost, v3Impact, v3Price, walkSwap, type TickLiq } from "../src/index.js";

const Q96 = 2 ** 96;
const sqrtFor = (price: number, tokenIsToken0: boolean) => {
  const raw = tokenIsToken0 ? (price * 1e6) / 1e8 : 1e8 / (price * 1e6);
  return BigInt(Math.floor(Math.sqrt(raw) * Q96));
};
const tickOf = (sqrtPriceX96: bigint) => Math.floor(Math.log((Number(sqrtPriceX96) / Q96) ** 2) / Math.log(1.0001));
const sq = (t: number) => Math.sqrt(Math.pow(1.0001, t));

const base = (tokenIsToken0: boolean, L = 500_000_000_000n) => {
  const sqrtPriceX96 = sqrtFor(350, tokenIsToken0);
  return { sqrtPriceX96, liquidity: L, tick: tickOf(sqrtPriceX96), tokenIsToken0, tokenDecimals: 8, feeBps: 0, windowBps: 300 };
};

describe("walkSwap with no initialized ticks (constant liquidity)", () => {
  for (const tokenIsToken0 of [true, false]) {
    for (const side of ["buy", "sell"] as const) {
      it(`agrees with the constant-liquidity estimate: token${tokenIsToken0 ? 0 : 1}, ${side}`, () => {
        const b = base(tokenIsToken0);
        const w = walkSwap({ ...b, ticks: [], side, usdBudget: 2_000 })!;
        const k = v3Impact({ ...b, tickSpacing: 60, tickLower: b.tick - 20_000, tickUpper: b.tick + 20_000, usdc: 2_000, side })!;
        expect(w.windowExceeded).toBe(false);
        expect(Math.abs(w.slippageBps - k.slippageBps)).toBeLessThan(2); // bps; v3Impact uses an averaged price
        expect(w.usdIn).toBeCloseTo(2_000, 3);
      });
    }
  }
});

describe("walkSwap across ticks", () => {
  it("crossing an initialized tick changes liquidity: cost matches a hand calculation (buy, token0)", () => {
    const b = base(true, 1_000_000_000n);
    const t1 = b.tick + 40; // boundary 40 ticks (0.4%) above
    const extra = 3_000_000_000n; // liquidity added when crossing upward
    const ticks: TickLiq[] = [{ tick: t1, liquidityNet: extra }];
    const sp0 = Number(b.sqrtPriceX96) / Q96;
    const target = 100; // bps
    const spT = sp0 * Math.sqrt(1.01);
    const L1 = Number(b.liquidity);
    const L2 = L1 + Number(extra);
    // USDC (token1) in = L * dSqrt, segment by segment
    const expected = (L1 * (sq(t1) - sp0) + L2 * (spT - sq(t1))) / 1e6;
    const w = walkSwap({ ...b, ticks, side: "buy", targetBps: target })!;
    expect(w.ticksCrossed).toBe(1);
    expect(w.usdIn).toBeCloseTo(expected, 4);
    // and it is cheaper than if liquidity had stayed at L1 the whole way: more liquidity above => costlier, not cheaper
    const noTicks = walkSwap({ ...b, ticks: [], side: "buy", targetBps: target })!;
    expect(w.usdIn).toBeGreaterThan(noTicks.usdIn);
  });
  it("selling (token0 in) walks downward and subtracts liquidityNet when crossing", () => {
    const b = base(true, 4_000_000_000n);
    const t1 = b.tick - 30;
    // crossing downward removes liquidityNet: net=+3e9 => liquidity below the tick is 1e9
    const ticks: TickLiq[] = [{ tick: t1, liquidityNet: 3_000_000_000n }];
    const sp0 = Number(b.sqrtPriceX96) / Q96;
    const spT = sp0 * Math.sqrt(1 - 0.01);
    const price = v3Price(b.sqrtPriceX96, true, 8);
    const expectedTokens = (4e9 * (1 / sq(t1) - 1 / sp0) + 1e9 * (1 / spT - 1 / sq(t1))) / 1e8;
    const w = walkSwap({ ...b, ticks, side: "sell", targetBps: 100 })!;
    expect(w.ticksCrossed).toBe(1);
    expect(w.usdIn).toBeCloseTo(expectedTokens * price, 3);
  });
  it("an empty range (liquidity drops to zero) makes the push cheap: cost stops at the edge of the liquidity", () => {
    const b = base(true, 1_000_000_000n);
    const t1 = b.tick + 20;
    const ticks: TickLiq[] = [{ tick: t1, liquidityNet: -1_000_000_000n }]; // all liquidity ends at t1
    const sp0 = Number(b.sqrtPriceX96) / Q96;
    const toEdge = (1e9 * (sq(t1) - sp0)) / 1e6;
    const w = walkSwap({ ...b, ticks, side: "buy", targetBps: 100 })!;
    expect(w.usdIn).toBeCloseTo(toEdge, 4);
    expect(w.movedBps).toBeGreaterThan(90); // the price still moves the full distance, for free after the edge
  });
  it("flags a lower bound when a trade needs data beyond the loaded window", () => {
    const b = base(true, 1_000_000_000n);
    const w = walkSwap({ ...b, ticks: [], side: "buy", usdBudget: 5_000_000 })!;
    expect(w.windowExceeded).toBe(true);
  });
  it("fees raise the cost and slippage", () => {
    const b = base(true);
    const a = walkSwap({ ...b, ticks: [], side: "buy", usdBudget: 1_000 })!;
    const c = walkSwap({ ...b, feeBps: 30, ticks: [], side: "buy", usdBudget: 1_000 })!;
    expect(c.slippageBps - a.slippageBps).toBeGreaterThan(25);
  });
});

describe("manipulationCost", () => {
  it("uses real tick data: stacked liquidity beyond the first tick costs more than the single-range lower bound", () => {
    const A = 200_000_000n; // the position around the current price: [tick-5, tick+5]
    const B = 5_000_000_000n; // stacked positions beyond it: [tick+5, tick+200] and [tick-200, tick-5]
    const b = base(true, A);
    const thin = manipulationCost({ ...b, ticks: [{ tick: b.tick - 5, liquidityNet: A }, { tick: b.tick + 5, liquidityNet: -A }], bps: 100 })!;
    const stacked = manipulationCost({
      ...b,
      ticks: [
        { tick: b.tick - 200, liquidityNet: B },
        { tick: b.tick - 5, liquidityNet: A - B },
        { tick: b.tick + 5, liquidityNet: B - A },
        { tick: b.tick + 200, liquidityNet: -B },
      ],
      bps: 100,
    })!;
    // Single-range bound (old method) would call this pool nearly free to move; real tick data shows it is not.
    expect(stacked.usd).toBeGreaterThan(thin.usd * 5);
  });
  it("picks the cheaper direction", () => {
    const b = base(true, 1_000_000_000n);
    const lopsided = manipulationCost({ ...b, ticks: [{ tick: b.tick + 3, liquidityNet: 9_000_000_000n }], bps: 100 })!;
    expect(lopsided.side).toBe("sell"); // all the extra liquidity sits above, so pushing down is cheaper
  });
});
