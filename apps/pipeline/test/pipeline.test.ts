import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildReading, toTokenRef, type ApiToken, type HistoryPoint, type LatestDoc } from "@assay/core";
import { FileStore, MemoryStore } from "../lib/store.js";
import { buildPublicFiles } from "../lib/publish.js";
import { fetchActionDetails, runRefresh } from "../lib/refresh.js";

const fx = (f: string) => fs.readFileSync(path.resolve(__dirname, "../../../fixtures", f), "utf8");
const list = (JSON.parse(fx("tokenized-stocks.list.json")).tokens as ApiToken[]).map(toTokenRef);

async function seeded() {
  const s = new MemoryStore();
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
  await s.set("history:AAPLc", [{ t: now, dex: 1, ref: 1, devBps: 0, state: "Fresh", depth: 1 }] satisfies HistoryPoint[]);
  await s.set("events", [{ t: now, symbol: "AAPLc", from: null, to: "Fresh", reason: "a < b & c" }]);
  return s;
}

describe("FileStore", () => {
  it("round-trips state through files, so history rolls forward between runs", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "assay-store-"));
    const a = new FileStore();
    await a.set("history:AAPLc", [{ t: "x" }]);
    await a.set("latest", { updatedAt: "now" });
    a.save(dir);
    const b = FileStore.load(dir);
    expect(await b.get("history:AAPLc")).toEqual([{ t: "x" }]);
    expect(await b.get("latest")).toEqual({ updatedAt: "now" });
    expect(b.keys().sort()).toEqual(["history:AAPLc", "latest"]);
  });
  it("a missing directory is a first run, not an error", () => {
    expect(FileStore.load(path.join(os.tmpdir(), "assay-does-not-exist-" + Date.now())).keys()).toEqual([]);
  });
});

describe("buildPublicFiles", () => {
  it("publishes board, status, per-token, history, actions, events and RSS with the disclaimer", async () => {
    const files = await buildPublicFiles(await seeded(), new Date().toISOString());
    for (const f of ["board.json", "status.json", "actions.json", "events.json", "feed.xml", "token/AAPLc.json", "history/AAPLc.json", "token/CRCLc.json"]) {
      expect(files.has(f), f).toBe(true);
    }
    expect(JSON.parse(files.get("board.json")!).disclaimer).toMatch(/Not financial advice/);
    const status = JSON.parse(files.get("status.json")!);
    expect(status.cadenceMin).toBe(10);
    expect(status.tracked).toBe(12);
    expect(JSON.parse(files.get("token/AAPLc.json")!).history).toHaveLength(1);
    // CRCLc has no pool in this seed: an explicit unavailable reading, not a number
    expect(JSON.parse(files.get("token/CRCLc.json")!).reading.status).toBe("unavailable");
  });
  it("escapes the RSS feed", async () => {
    const xml = (await buildPublicFiles(await seeded(), "now")).get("feed.xml")!;
    expect(xml).toContain("<rss");
    expect(xml).toContain("a &lt; b &amp; c");
  });
  it("refuses to publish when there is nothing real to publish", async () => {
    await expect(buildPublicFiles(new MemoryStore(), "now")).rejects.toThrow(/no latest/);
  });
  it("contains no secrets or private keys", async () => {
    const all = [...(await buildPublicFiles(await seeded(), "now")).values()].join("\n");
    expect(all).not.toMatch(/PRIVATE_KEY|BEGIN [A-Z ]*PRIVATE|0x[0-9a-fA-F]{64}(?![0-9a-fA-F])(?=["\s,\]}]*$)/m);
  });
});

describe("refresh when sources fail", () => {
  it("records the failure and keeps prior readings without inventing values", async () => {
    const s = await seeded();
    const prev = await s.get<LatestDoc>("latest");
    const doc = await runRefresh({ store: s, fetchFn: (async () => { throw new Error("dns down"); }) as unknown as typeof fetch });
    expect(doc.sources.tokensApi.ok).toBe(false);
    expect(doc.sources.tokensApi.error).toMatch(/dns down/);
    expect(doc.readings).toEqual(prev!.readings);
    expect(doc.updatedAt).toBe(prev!.updatedAt);
  });
  it("with no prior data returns an empty board, not fake numbers", async () => {
    const doc = await runRefresh({ store: new MemoryStore(), fetchFn: (async () => new Response("x", { status: 503 })) as unknown as typeof fetch });
    expect(doc.readings).toEqual([]);
    expect(doc.sources.tokensApi.ok).toBe(false);
  });
  it("records a failed run and re-throws instead of hiding it", async () => {
    const saved: Record<string, unknown> = {};
    const store = {
      get: async () => null,
      set: async (k: string, v: unknown) => { if (k === "multipliers") throw new Error("write failed"); saved[k] = v; },
    };
    const okFetch = (async () => new Response(JSON.stringify({ tokens: [] }), { status: 200 })) as unknown as typeof fetch;
    await expect(runRefresh({ store, fetchFn: okFetch })).rejects.toThrow(/write failed/);
    expect((saved.run as { ok: boolean; consecutiveFailures: number }).ok).toBe(false);
  });
});

describe("corporate action records", () => {
  const id = "b80863d5-db65-43a7-8578-59adf6922e78";
  const base = async () => {
    const s = new MemoryStore();
    await s.set("actions", [{ kind: "announcement", symbol: "NOKc", address: "0x1", detectedAt: "t", actionId: id }]);
    return s;
  };
  it("stores the issuer record on success", async () => {
    const s = await base();
    await fetchActionDetails(s, (async () => new Response(JSON.stringify({ status: "APPLIED" }), { status: 200 })) as unknown as typeof fetch, "t");
    expect((await s.get<Record<string, { status: string }>>("actionDetails"))![id]!.status).toBe("ok");
  });
  it("records upstream failures as explained 'unavailable' and retries next run", async () => {
    const s = await base();
    await fetchActionDetails(s, (async () => new Response("{}", { status: 503 })) as unknown as typeof fetch, "t");
    const d1 = (await s.get<Record<string, { status: string; reason?: string }>>("actionDetails"))![id]!;
    expect(d1.status).toBe("unavailable");
    let calls = 0;
    await fetchActionDetails(s, (async () => { calls++; return new Response(JSON.stringify({ ok: 1 }), { status: 200 }); }) as unknown as typeof fetch, "t2");
    expect(calls).toBe(1);
    expect((await s.get<Record<string, { status: string }>>("actionDetails"))![id]!.status).toBe("ok");
  });
});
