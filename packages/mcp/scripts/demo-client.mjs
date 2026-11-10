// Starts the built stdio server exactly as an agent would, lists tools and calls two of them against the REAL data.
// Usage: node scripts/demo-client.mjs [command] [args...]   (default: node ../dist/assay-mcp.mjs)
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const [cmd, ...args] = process.argv.slice(2).length ? process.argv.slice(2) : ["node", path.join(here, "..", "dist", "assay-mcp.mjs")];
const transport = new StdioClientTransport({ command: cmd, args, stderr: "inherit" });
const client = new Client({ name: "demo", version: "0" });
await client.connect(transport);
const { tools } = await client.listTools();
console.log("TOOLS:", tools.map((t) => t.name).join(", "));
const show = (r) => JSON.parse(r.content[0].text);
const t0 = Date.now();
const check = show(await client.callTool({ name: "check_before_trade", arguments: { symbol: "CRCLc", usd: 5000, side: "buy" } }));
console.log("check_before_trade CRCLc $5000 buy:", JSON.stringify({ verdict: check.verdict, readOnly: check.readOnly, source: check.source, liveError: check.liveError, reasons: check.reasons, slippageBps: check.quote?.slippageBps, ms: Date.now() - t0 }));
const board = show(await client.callTool({ name: "assay_board", arguments: {} }));
console.log("assay_board:", JSON.stringify({ ageSec: board.ageSec, readings: board.readings.length, assayable: board.readings.filter((r) => r.status === "ok").length, states: board.readings.map((r) => `${r.symbol}:${r.state ?? "unavailable"}`).join(" ") }));
await client.close();
