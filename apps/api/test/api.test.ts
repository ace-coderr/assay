import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { buildReading, toTokenRef, type ApiToken, type PoolRead } from "@assay/core";
import { memoryStore, type LatestDoc } from "../lib/store.js";
import { handle } from "../lib/router.js";
import { runRefresh, decodeLog } from "../lib/refresh.js";
import { assertSafeWebhookUrl } from "../lib/webhooks.js";

const fx = (f: string) => fs.readFileSync(path.resolve(__dirname, "../../../fixtures", f), "utf8");
const apiTokens = JSON.parse(fx("tokenized-stocks.list.json")).tokens as ApiToken[];
const list = apiTokens.map(toTokenRef);
const rows = fx("pool-reads.jsonl").trim().split("\n").map((l) => JSON.parse(l));

function seed(): LatestDoc {
  const readings = list
    .filter((t) => t.navPrice != null)
    .map((t) => {
      const pools: PoolRead[] = rows
        .filter((r) => r.sym === t.symbol)
        .map((r) => ({ venue: "uniswap-v3", pool: r.pool, feeBps: Number(r.fee) / 100, spotPrice: r.rpc0.price, usdcDepth: r.rpc0.usdcDepth, liquidity: BigInt(r.rpc0.liq), twapPrice: null }));
      return buildReading({ token: t, pools, now: new Date(Date.parse(t.navUpdatedAt!) + 3600_000) });
    });
  const now = new Date().toISOString();
  return { updatedAt: now, sources: { tokensApi: { ok: true, at: now }, rpc: { ok: true, at: now } }, untracked: 306, totalTokens: 318, readings: JSON.parse(JSON.stringify(readings, (_k, v) => (typeof v === "bigint" ? v.toString() : v))) };
}

const req = (p: string, init?: RequestInit) => new Request("https://assay.test" + p, { headers: { "x-nf-client-connection-ip": "t" + Math.random() }, ...init });

describe("HTTP API", () => {
  it("serves the board with a disclaimer and explicit unavailable readings", async () => {
    const s = memoryStore();
    await s.set("latest", seed());
    const res = await handle(req("/api/board"), s);
    expect(res.status).toBe(200);
    const b = await res.json();
    expect(b.disclaimer).toMatch(/Not financial advice/);
    const crcl = b.readings.find((r: any) => r.symbol === "CRCLc");
    expect(crcl.status).toBe("unavailable");
    expect(crcl.dexPrice).toBeUndefined();
  });
  it("token report, history and 404s", async () => {
    const s = memoryStore();
    await s.set("latest", seed());
    expect((await handle(req("/api/token/aapl"), s)).status).toBe(200);
    expect((await handle(req("/api/token/NOPE"), s)).status).toBe(404);
    expect((await handle(req("/api/token/..%2F..%2Fetc"), s)).status).toBe(400);
  });
  it("probe is a read-only quote; rejects absurd sizes and bad sides", async () => {
    const s = memoryStore();
    await s.set("latest", seed());
    expect((await handle(req("/api/probe?symbol=AAPLc&usd=-5"), s)).status).toBe(400);
    expect((await handle(req("/api/probe?symbol=AAPLc&usd=1e12"), s)).status).toBe(400);
    expect((await handle(req("/api/probe?symbol=AAPLc&usd=100&side=swap"), s)).status).toBe(400);
  });
  it("check returns a verdict flagged readOnly", async () => {
    const s = memoryStore();
    await s.set("latest", seed());
    const v = await (await handle(req("/api/check?symbol=AAPLc"), s)).json();
    expect(v.readOnly).toBe(true);
    expect(["ok", "caution", "avoid", "unknown"]).toContain(v.verdict);
  });
  it("has no trade/swap route", async () => {
    const s = memoryStore();
    for (const p of ["/api/swap", "/api/trade", "/api/execute"]) expect((await handle(req(p, { method: "POST" }), s)).status).toBe(404);
  });
  it("rate limits a single client", async () => {
    const s = memoryStore();
    const headers = { "x-nf-client-connection-ip": "flood" };
    let last = 200;
    for (let i = 0; i < 130; i++) last = (await handle(new Request("https://assay.test/api/events", { headers }), s)).status;
    expect(last).toBe(429);
  });
  it("RSS feed is valid-looking XML", async () => {
    const s = memoryStore();
    await s.set("events", [{ t: new Date().toISOString(), symbol: "AAPLc", from: null, to: "Fresh", reason: "a < b & c" }]);
    const x = await (await handle(req("/api/feed.xml"), s)).text();
    expect(x).toContain("<rss");
    expect(x).toContain("a &lt; b &amp; c");
  });
});

describe("refresh when sources fail", () => {
  it("records the failure and keeps prior readings without inventing values", async () => {
    const s = memoryStore();
    const prev = seed();
    await s.set("latest", prev);
    const doc = await runRefresh({ store: s, fetchFn: (async () => { throw new Error("dns down"); }) as unknown as typeof fetch });
    expect(doc.sources.tokensApi.ok).toBe(false);
    expect(doc.sources.tokensApi.error).toMatch(/dns down/);
    expect(doc.readings).toEqual(prev.readings);
    expect(doc.updatedAt).toBe(prev.updatedAt);
  });
  it("with no prior data returns an empty board, not fake numbers", async () => {
    const s = memoryStore();
    const doc = await runRefresh({ store: s, fetchFn: (async () => new Response("x", { status: 503 })) as unknown as typeof fetch });
    expect(doc.readings).toEqual([]);
    expect(doc.sources.tokensApi.ok).toBe(false);
  });
});

describe("webhook SSRF guard", () => {
  it.each(["http://example.com/x", "https://localhost/x", "https://127.0.0.1/x", "https://10.0.0.5/x", "https://169.254.169.254/latest", "https://[::1]/x", "https://user:pw@example.com/", "https://example.com:8443/x", "not a url"])("rejects %s", async (u) => {
    await expect(assertSafeWebhookUrl(u)).rejects.toThrow();
  });
});

describe("log decoding", () => {
  it("decodes a UIMultiplierUpdated log", () => {
    const e18 = (n: bigint) => n.toString(16).padStart(64, "0");
    const data = ("0x" + e18(1_000_000_000_000_000_000n) + e18(1_010_000_000_000_000_000n) + e18(1_800_000_000n)) as `0x${string}`;
    const a = decodeLog({ address: "0xabc", topics: ["0x2205df4534432b2f60654a3fdb48737ffdaf3e9edb1a498bd985bc026b15b055"], data, blockNumber: "0x10", transactionHash: "0xdead" }, "TESTc", "now");
    expect(a.kind).toBe("multiplier-scheduled");
    expect(a.old).toBe(1);
    expect(a.new).toBeCloseTo(1.01, 12);
    expect(a.effectiveAt).toBe(new Date(1_800_000_000 * 1000).toISOString());
  });
});
