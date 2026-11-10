// Requests a matrix of URLs against a deployment and prints status codes, to find 4xx/5xx sources.
const base = process.argv[2] ?? "https://assay-onbase.netlify.app";
const GET = [
  "/", "/app", "/app/token", "/app/token/AAPLc", "/app/token/CRCLc", "/favicon.ico", "/favicon.svg", "/robots.txt", "/sitemap.xml",
  "/api", "/api/", "/api/status", "/api/board", "/api/events", "/api/actions", "/api/feed.xml",
  "/api/token/AAPLc", "/api/token/aapl", "/api/token/CRCLc", "/api/token/GOOGLc", "/api/token/AMDc", "/api/token/NOPE",
  "/api/history/AAPLc", "/api/history/CRCLc", "/api/history/NOPE",
  "/api/probe?symbol=AAPLc&usd=1000", "/api/probe?symbol=GOOGLc&usd=1000", "/api/probe?symbol=CRCLc&usd=1000", "/api/probe?symbol=NOPE&usd=1000", "/api/probe?symbol=AAPLc&usd=abc",
  "/api/check?symbol=AAPLc", "/api/check?symbol=GOOGLc", "/api/check?symbol=NOPE",
  "/api/actions/b80863d5-db65-43a7-8578-59adf6922e78", "/api/actions/00000000-0000-4000-8000-000000000000", "/api/actions/not-a-uuid",
  "/mcp",
];
const rows = [];
for (const p of GET) {
  const t = Date.now();
  try {
    const r = await fetch(base + p, { redirect: "manual" });
    await r.arrayBuffer();
    rows.push([r.status, Date.now() - t, "GET", p]);
  } catch (e) {
    rows.push(["ERR", Date.now() - t, "GET", p + " " + e.message]);
  }
}
for (const [m, p, body] of [
  ["POST", "/mcp", { jsonrpc: "2.0", id: 1, method: "tools/list" }],
  ["POST", "/mcp", { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "assay_token", arguments: { symbol: "CRCLc" } } }],
  ["POST", "/mcp", { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "nope", arguments: {} } }],
  ["POST", "/api/webhooks", { url: "http://x" }],
  ["DELETE", "/api/webhooks?id=a&secret=b", null],
]) {
  const t = Date.now();
  const r = await fetch(base + p, { method: m, headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: body ? JSON.stringify(body) : undefined });
  await r.arrayBuffer();
  rows.push([r.status, Date.now() - t, m, p]);
}
for (const r of rows) console.log(String(r[0]).padEnd(4), String(r[1]).padStart(5) + "ms", r[2].padEnd(6), r[3]);
