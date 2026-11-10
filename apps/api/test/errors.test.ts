import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { buildReading, toTokenRef, type ApiToken } from "@assay/core";
import { memoryStore, type LatestDoc } from "../lib/store.js";
import { handle } from "../lib/router.js";
import { runRefresh } from "../lib/refresh.js";

const fx = (f: string) => fs.readFileSync(path.resolve(__dirname, "../../../fixtures", f), "utf8");
const list = (JSON.parse(fx("tokenized-stocks.list.json")).tokens as ApiToken[]).map(toTokenRef);
const req = (p: string, init?: RequestInit) => new Request("https://assay.test" + p, { headers: { "x-nf-client-connection-ip": "e" + Math.random() }, ...init });

async function seeded() {
  const s = memoryStore();
  const ref = list.filter((t) => t.navPrice != null);
  const readings = ref.map((t) => buildReading({ token: t, pools: [], now: new Date(Date.parse(t.navUpdatedAt!) + 3600_000) }));
  const now = new Date().toISOString();
  const doc: LatestDoc = {
    updatedAt: now,
    sources: { tokensApi: { ok: true, at: now }, rpc: { ok: true, at: now } },
    untracked: list.length - ref.length,
    totalTokens: list.length,
    untrackedTokens: list.filter((t) => t.navPrice == null).map((t) => ({ symbol: t.symbol, multiplier: t.multiplier })),
    readings,
  };
  await s.set("latest", doc);
  return s;
}

describe("expected conditions are explained states, not errors", () => {
  it("probing a token with no pool is HTTP 200 with an explanation", async () => {
    const s = await seeded();
    const r = await handle(req("/api/probe?symbol=CRCLc&usd=1000"), s);
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.ok).toBe(false);
    expect(j.status).toBe("unavailable");
    expect(j.code).toBe("no-pool");
    expect(j.error).toMatch(/No pool on Base yet/);
  });
  it("a real token with no reference value gets a 200 'unavailable', not a 404", async () => {
    const s = await seeded();
    const r = await handle(req("/api/token/AMDc"), s);
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.reading.status).toBe("unavailable");
    expect(j.reading.unavailableCode).toBe("no-reference");
    expect(j.reading.dexPrice).toBeUndefined();
    expect((await handle(req("/api/history/AMDc"), s)).status).toBe(200);
  });
  it("a symbol that does not exist is still a 404", async () => {
    const s = await seeded();
    expect((await handle(req("/api/token/ZZZZ"), s)).status).toBe(404);
    expect((await handle(req("/api/probe?symbol=ZZZZ&usd=10"), s)).status).toBe(404);
  });
  it("upstream corporate-action failures are explained with HTTP 200", async () => {
    const s = await seeded();
    const id = "b80863d5-db65-43a7-8578-59adf6922e78";
    const f404 = (async () => new Response("{}", { status: 404 })) as unknown as typeof fetch;
    const f503 = (async () => new Response("{}", { status: 503 })) as unknown as typeof fetch;
    const fDown = (async () => { throw new Error("socket hang up"); }) as unknown as typeof fetch;
    for (const f of [f404, f503, fDown]) {
      const r = await handle(req(`/api/actions/${id}`), s, f);
      expect(r.status).toBe(200);
      expect((await r.json()).status).toBe("unavailable");
    }
    expect((await handle(req("/api/actions/not-a-uuid"), s)).status).toBe(400);
  });
  it("status exposes refresh health", async () => {
    const s = await seeded();
    await s.set("run", { at: "x", durationMs: 1234, ok: true, steps: { readPools: 900 }, consecutiveFailures: 0 });
    const j = await (await handle(req("/api/status"), s)).json();
    expect(j.refresh.durationMs).toBe(1234);
    expect(typeof j.assayable).toBe("number");
  });
});

describe("probe labels", () => {
  it("labels a size beyond the active range AT_LEAST with an explanation, and a small size ESTIMATE", async () => {
    const s = memoryStore();
    const now = new Date().toISOString();
    const raw = (350 * 1e6) / 1e8;
    const sqrtPriceX96 = BigInt(Math.floor(Math.sqrt(raw) * 2 ** 96)).toString();
    const tick = Math.floor(Math.log(raw) / Math.log(1.0001));
    const lo = Math.floor(tick / 60) * 60;
    await s.set("latest", {
      updatedAt: now,
      sources: { tokensApi: { ok: true, at: now }, rpc: { ok: true, at: now } },
      untracked: 0,
      totalTokens: 1,
      readings: [{
        symbol: "TESTc", address: "0x0000000000000000000000000000000000000001", status: "ok", state: "Fresh", reasons: [], multiplier: 1,
        dexPrice: 350, reference: 350, deviationBps: 0, poolsConsidered: 1, poolsRejected: [], readAt: now,
        poolUsed: { venue: "uniswap-v3", pool: "0x0000000000000000000000000000000000000002", feeBps: 30, spotPrice: 350, usdcDepth: 20000, liquidity: "20000000000", sqrtPriceX96, tick, tickSpacing: 60, tickLower: lo, tickUpper: lo + 60, tokenIsToken0: true },
      }],
    });
    const small = await (await handle(req("/api/probe?symbol=TESTc&usd=10"), s)).json();
    expect(small.label).toBe("ESTIMATE");
    const big = await (await handle(req("/api/probe?symbol=TESTc&usd=500000"), s)).json();
    expect(big.label).toBe("AT_LEAST");
    expect(big.quote.lowerBound).toBe(true);
    expect(big.explanation).toMatch(/^At least:/);
  });
});

describe("refresh health recording", () => {
  it("records a failed run and re-throws instead of hiding it", async () => {
    const bad = {
      get: async () => null,
      set: async (k: string) => { if (k === "multipliers") throw new Error("blob write failed"); },
    };
    const okFetch = (async () => new Response(JSON.stringify({ tokens: [] }), { status: 200 })) as unknown as typeof fetch;
    const saved: Record<string, unknown> = {};
    const store = { get: bad.get, set: async (k: string, v: unknown) => { await bad.set(k); saved[k] = v; } };
    await expect(runRefresh({ store, fetchFn: okFetch })).rejects.toThrow(/blob write failed/);
    expect((saved.run as { ok: boolean; consecutiveFailures: number }).ok).toBe(false);
    expect((saved.run as { consecutiveFailures: number }).consecutiveFailures).toBe(1);
  });
});
