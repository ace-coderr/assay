import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createAssayMcpServer } from "@assay/mcp";
import { buildReading, toTokenRef, type ApiToken, type PoolRead } from "@assay/core";
import { memoryStore, type LatestDoc } from "../lib/store.js";
import { mcpBackend } from "../lib/mcp-backend.js";

const fx = (f: string) => fs.readFileSync(path.resolve(__dirname, "../../../fixtures", f), "utf8");
const list = (JSON.parse(fx("tokenized-stocks.list.json")).tokens as ApiToken[]).map(toTokenRef);
const rows = fx("pool-reads.jsonl").trim().split("\n").map((l) => JSON.parse(l));

async function connect() {
  const store = memoryStore();
  const readings = list.filter((t) => t.navPrice != null).map((t) => {
    const pools: PoolRead[] = rows.filter((r) => r.sym === t.symbol).map((r) => ({ venue: "uniswap-v3", pool: r.pool, feeBps: Number(r.fee) / 100, spotPrice: r.rpc0.price, usdcDepth: r.rpc0.usdcDepth, liquidity: BigInt(r.rpc0.liq), twapPrice: null }));
    return buildReading({ token: t, pools, now: new Date(Date.parse(t.navUpdatedAt!) + 3600_000) });
  });
  const now = new Date().toISOString();
  await store.set("latest", { updatedAt: now, sources: { tokensApi: { ok: true, at: now }, rpc: { ok: true, at: now } }, untracked: 306, totalTokens: 318, readings } satisfies LatestDoc);
  const server = createAssayMcpServer(mcpBackend(store));
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(b);
  return client;
}

describe("MCP server", () => {
  it("exposes exactly the five read-only tools and nothing that trades", async () => {
    const c = await connect();
    const { tools } = await c.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["assay_board", "assay_token", "check_before_trade", "list_corporate_actions", "probe_liquidity"]);
    for (const t of tools) expect(t.annotations?.readOnlyHint).toBe(true);
    expect(tools.map((t) => t.name).join(" ") + JSON.stringify(tools.map((t) => Object.keys((t.inputSchema as any).properties ?? {})))).not.toMatch(/swap|trade_|execute|wallet|private|approve|slippageTolerance|recipient/i);
  });
  it("check_before_trade returns a verdict only", async () => {
    const c = await connect();
    const r: any = await c.callTool({ name: "check_before_trade", arguments: { symbol: "AAPLc", usd: 100 } });
    const body = JSON.parse(r.content[0].text);
    expect(body.readOnly).toBe(true);
    expect(["ok", "caution", "avoid", "unknown"]).toContain(body.verdict);
  });
  it("assay_token reports unavailable for tokens with no reference", async () => {
    const c = await connect();
    const r: any = await c.callTool({ name: "assay_token", arguments: { symbol: "AMDc" } });
    expect(JSON.parse(r.content[0].text).status).toBe("unavailable");
  });
  it("rejects bad input", async () => {
    const c = await connect();
    const r: any = await c.callTool({ name: "probe_liquidity", arguments: { symbol: "AAPLc", usd: -1 } }).catch((e) => ({ isError: true, e }));
    expect(r.isError).toBe(true);
  });
});
