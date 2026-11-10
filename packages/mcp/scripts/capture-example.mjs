// Captures one real check_before_trade exchange from the built server, for the Agent page example.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const client = new Client({ name: "capture", version: "0" });
await client.connect(new StdioClientTransport({ command: "node", args: [path.join(here, "..", "dist", "assay-mcp.mjs")], stderr: "ignore" }));
const args = { symbol: "AAPLc", usd: 2000, side: "buy" };
const res = await client.callTool({ name: "check_before_trade", arguments: args });
const body = JSON.parse(res.content[0].text);
const q = body.quote ?? {};
console.log(JSON.stringify({
  capturedAt: new Date().toISOString(),
  request: { name: "check_before_trade", arguments: args },
  response: { verdict: body.verdict, reasons: body.reasons, readOnly: body.readOnly, source: body.source, symbol: body.symbol, readAt: body.readAt, quote: { side: q.side, sizeUsd: q.sizeUsd, slippageBps: q.slippageBps && Number(q.slippageBps.toFixed(1)), lowerBound: q.lowerBound, feeBps: q.feeBps, ticksCrossed: q.ticksCrossed }, disclaimer: body.disclaimer },
}, null, 2));
await client.close();
