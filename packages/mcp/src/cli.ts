// Assay MCP server over stdio (the build adds the shebang). Agents start this process themselves; there is no hosted endpoint.
// stdout carries the protocol, so all logging goes to stderr.
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createAssayMcpServer, publishedBackend } from "./index.js";

const server = createAssayMcpServer(publishedBackend());
await server.connect(new StdioServerTransport());
console.error("assay-mcp: ready (read-only; data from the Assay data branch, live reads from public Base RPCs)");
