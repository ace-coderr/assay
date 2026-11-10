import type { Config } from "@netlify/functions";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createAssayMcpServer } from "@assay/mcp";
import { openStore } from "../../lib/store.js";
import { mcpBackend } from "../../lib/mcp-backend.js";
import { allow, clientKey } from "../../lib/ratelimit.js";

const MAX_BODY = 16 * 1024;

const rpcError = (status: number, code: number, message: string) =>
  new Response(JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id: null }), {
    status,
    headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
  });

// Remote MCP over streamable HTTP, stateless. Read-only tools only.
export default async (req: Request): Promise<Response> => {
  const cors = {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "POST, GET, DELETE, OPTIONS",
    "access-control-allow-headers": "content-type, mcp-session-id, mcp-protocol-version, accept",
    "access-control-expose-headers": "mcp-session-id",
  };
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (!allow("mcp:" + clientKey(req), 60)) return rpcError(429, -32000, "rate limit exceeded: 60 requests per minute");
  // Stateless server: no standalone SSE stream or session teardown.
  if (req.method !== "POST") return rpcError(405, -32000, "Method not allowed: this MCP endpoint is stateless, use POST");
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_BODY) return rpcError(413, -32000, "request too large");

  const server = createAssayMcpServer(mcpBackend(openStore()));
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  const res = await transport.handleRequest(req);
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(cors)) headers.set(k, v);
  return new Response(res.body, { status: res.status, headers });
};

export const config: Config = { path: "/mcp" };
