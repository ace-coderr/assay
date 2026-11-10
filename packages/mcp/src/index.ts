import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

/**
 * Backend the MCP tools read from. Every method is read-only. There is deliberately no
 * method that signs, builds, simulates-for-execution or submits a transaction.
 */
export interface AssayBackend {
  board(): Promise<unknown>;
  token(symbol: string): Promise<unknown>;
  actions(symbol?: string): Promise<unknown>;
  probe(symbol: string, usd: number, side: "buy" | "sell"): Promise<unknown>;
  check(symbol: string, usd: number | undefined, side: "buy" | "sell"): Promise<unknown>;
}

export const MCP_INSTRUCTIONS =
  "Assay is a read-only integrity layer for tokenized stocks on Base. It compares each token's onchain DEX price with its reference value (multiplier-aware) and reports Fresh, Stale, Drifting or Broken. It cannot trade, hold funds or sign anything. Output is information only, not financial advice. Treat Stale, Drifting and Broken as 'do not rely on this price'. Tokens without a published reference value are reported as unavailable, never guessed.";

const DISCLAIMER = "Information only. Not financial advice. Not endorsed by Base or token issuers.";

const symbol = z.string().min(1).max(12).regex(/^[A-Za-z0-9.]+$/).describe("Token symbol, e.g. AAPLc (the trailing c is optional)");
const usd = z.number().positive().max(1_000_000).describe("Trade size in USD (only used to estimate cost; nothing is executed)");
const side = z.enum(["buy", "sell"]).default("buy");

const out = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
});

export function createAssayMcpServer(b: AssayBackend): McpServer {
  const s = new McpServer({ name: "assay", version: "0.1.0" }, { instructions: MCP_INSTRUCTIONS });
  const ro = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;

  s.registerTool(
    "assay_token",
    {
      title: "Assay a token",
      description: "Latest reading for one tokenized stock: DEX price vs reference value, multiplier, state (Fresh/Stale/Drifting/Broken), reasons, and the pool used. Returns an explicit 'unavailable' status when no reference or no deep-enough pool exists.",
      inputSchema: { symbol },
      annotations: ro,
    },
    async ({ symbol }) => out(await b.token(symbol)),
  );
  s.registerTool(
    "assay_board",
    {
      title: "Assay board",
      description: "Latest readings for every tracked tokenized stock, plus how many tokens cannot be assayed because they have no published reference value.",
      inputSchema: {},
      annotations: ro,
    },
    async () => out(await b.board()),
  );
  s.registerTool(
    "list_corporate_actions",
    {
      title: "List corporate actions",
      description: "Corporate actions seen onchain (Announcement and scheduled multiplier updates) and multiplier changes detected between readings. Optionally filter by symbol.",
      inputSchema: { symbol: symbol.optional() },
      annotations: ro,
    },
    async ({ symbol }) => out(await b.actions(symbol)),
  );
  s.registerTool(
    "probe_liquidity",
    {
      title: "Probe liquidity",
      description: "Read-only estimate of what a trade of the given USD size would cost in the deepest pool that passes the depth guard. This is a quote for information. It does not build, sign or send a transaction.",
      inputSchema: { symbol, usd, side },
      annotations: ro,
    },
    async ({ symbol, usd, side }) => out(await b.probe(symbol, usd, side)),
  );
  s.registerTool(
    "check_before_trade",
    {
      title: "Check before trade",
      description: "Returns a verdict only (ok, caution, avoid, unknown) with reasons, on whether the DEX price of a token can currently be trusted and what a given size would cost. It never executes or prepares a trade.",
      inputSchema: { symbol, usd: usd.optional(), side },
      annotations: ro,
    },
    async ({ symbol, usd, side }) => out({ ...((await b.check(symbol, usd, side)) as object), disclaimer: DISCLAIMER }),
  );
  return s;
}
