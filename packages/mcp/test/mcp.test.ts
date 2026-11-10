import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildReading, toTokenRef, type ApiToken, type LatestDoc, type PoolRead, type Reading } from "@assay/core";
import { createAssayMcpServer, publishedBackend } from "../src/index.js";

const fx = (f: string) => fs.readFileSync(path.resolve(__dirname, "../../../fixtures", f), "utf8");
const list = (JSON.parse(fx("tokenized-stocks.list.json")).tokens as ApiToken[]).map(toTokenRef);
const rows = fx("pool-reads.jsonl").trim().split("\n").map((l) => JSON.parse(l));

function board(updatedAt = new Date().toISOString()): LatestDoc {
  const readings = list.filter((t) => t.navPrice != null).map((t) => {
    const pools: PoolRead[] = rows.filter((r) => r.sym === t.symbol).map((r) => ({ venue: "uniswap-v3", pool: r.pool, feeBps: Number(r.fee) / 100, spotPrice: r.rpc0.price, usdcDepth: r.rpc0.usdcDepth, liquidity: BigInt(r.rpc0.liq), twapPrice: null }));
    return buildReading({ token: t, pools, now: new Date(Date.parse(t.navUpdatedAt!) + 3600_000) });
  });
  const json = JSON.parse(JSON.stringify(readings, (_k, v) => (typeof v === "bigint" ? v.toString() : v))) as Reading[];
  return { updatedAt, sources: { tokensApi: { ok: true, at: updatedAt }, rpc: { ok: true, at: updatedAt } }, untracked: 1, totalTokens: json.length + 1, untrackedTokens: [{ symbol: "AMDc", multiplier: 1 }], readings: json };
}

const serve = (files: Record<string, unknown>, status = 200) =>
  (async (url: string | URL) => {
    const f = String(url).split("/").pop()!;
    return f in files ? new Response(JSON.stringify(files[f]), { status }) : new Response("nope", { status: 404 });
  }) as unknown as typeof fetch;

async function connect(opts: Parameters<typeof publishedBackend>[0]) {
  const server = createAssayMcpServer(publishedBackend(opts));
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(b);
  return client;
}
const call = async (c: Client, name: string, args: Record<string, unknown>) => JSON.parse(((await c.callTool({ name, arguments: args })) as { content: { text: string }[] }).content[0]!.text);

describe("assay MCP server (stdio build uses this same code)", () => {
  it("exposes exactly the five read-only tools and nothing that trades", async () => {
    const c = await connect({ fetchFn: serve({ "board.json": board() }) });
    const { tools } = await c.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["assay_board", "assay_token", "check_before_trade", "list_corporate_actions", "probe_liquidity"]);
    for (const t of tools) expect(t.annotations?.readOnlyHint).toBe(true);
    const surface = tools.map((t) => t.name).join(" ") + JSON.stringify(tools.map((t) => Object.keys((t.inputSchema as { properties?: object }).properties ?? {})));
    expect(surface).not.toMatch(/swap|execute|wallet|private|approve|recipient|slippageTolerance/i);
  });

  it("check_before_trade returns a verdict only, using a live reading when it works", async () => {
    const b = board();
    const live = async (r: Reading) => ({ ...r, block: "999" });
    const c = await connect({ fetchFn: serve({ "board.json": b }), live });
    const v = await call(c, "check_before_trade", { symbol: "AAPLc", usd: 100 });
    expect(v.readOnly).toBe(true);
    expect(v.source).toBe("live");
    expect(["ok", "caution", "avoid", "unknown"]).toContain(v.verdict);
    expect(v.disclaimer).toMatch(/Not financial advice/);
  });

  it("falls back to the published reading and says so when the live read fails", async () => {
    const c = await connect({ fetchFn: serve({ "board.json": board() }), live: async () => { throw new Error("rpc down"); } });
    const v = await call(c, "probe_liquidity", { symbol: "AAPLc", usd: 100 });
    expect(v.source).toBe("published");
    expect(v.liveError).toMatch(/rpc down/);
  });

  it("refuses to judge data that is too old (verdict unknown), rather than guessing", async () => {
    const old = new Date(Date.now() - 3 * 3600_000).toISOString();
    const b = board(old);
    b.readings.forEach((r) => (r.readAt = old));
    const c = await connect({ fetchFn: serve({ "board.json": b }), live: async () => { throw new Error("rpc down"); } });
    const v = await call(c, "check_before_trade", { symbol: "AAPLc", usd: 100 });
    expect(v.verdict).toBe("unknown");
  });

  it("reports an explicit unavailable state when the published data cannot be read", async () => {
    const c = await connect({ fetchFn: (async () => { throw new Error("offline"); }) as unknown as typeof fetch });
    const board_ = await call(c, "assay_board", {});
    expect(board_.status).toBe("unavailable");
    const v = await call(c, "check_before_trade", { symbol: "AAPLc" });
    expect(v.verdict).toBe("unknown");
    expect(v.reasons[0]).toMatch(/could not be read/);
  });

  it("tokens with no reference or no pool are explained, never priced", async () => {
    const c = await connect({ fetchFn: serve({ "board.json": board() }) });
    const noRef = await call(c, "assay_token", { symbol: "AMDc" });
    expect(noRef.reading.unavailableCode).toBe("no-reference");
    const noPool = await call(c, "probe_liquidity", { symbol: "CRCLc", usd: 1000, live: false });
    expect(noPool).toMatchObject({ ok: false, status: "unavailable" });
  });

  it("corporate actions include the issuer record", async () => {
    const actions = { actions: [{ kind: "announcement", symbol: "NOKc", address: "0x1", detectedAt: "t", actionId: "abc" }], details: { abc: { status: "ok", record: { x: 1 } } } };
    const c = await connect({ fetchFn: serve({ "board.json": board(), "actions.json": actions }) });
    const a = await call(c, "list_corporate_actions", { symbol: "NOKc" });
    expect(a.actions[0].issuerRecord.status).toBe("ok");
  });

  it("rejects bad input", async () => {
    const c = await connect({ fetchFn: serve({ "board.json": board() }) });
    const r = await c.callTool({ name: "probe_liquidity", arguments: { symbol: "AAPLc", usd: -1 } }).catch(() => ({ isError: true }));
    expect((r as { isError?: boolean }).isError).toBe(true);
  });
});
