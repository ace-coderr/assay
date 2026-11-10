import { useState } from "react";
import { CopyBlock, Disclaimer } from "../components/bits";
import { MCP_URL } from "../lib/api";

const TOOLS: [string, string, string][] = [
  ["assay_token", "{ symbol }", "Latest reading for one token: DEX vs reference, multiplier, state, reasons, pool used."],
  ["assay_board", "{}", "Every tracked token's latest reading and how many tokens cannot be assayed."],
  ["list_corporate_actions", "{ symbol? }", "Onchain announcements, scheduled multiplier updates, and multiplier changes detected."],
  ["probe_liquidity", "{ symbol, usd, side }", "Read-only estimate of what a size would cost in the deepest qualifying pool."],
  ["check_before_trade", "{ symbol, usd?, side }", "A verdict only: ok, caution, avoid or unknown, with reasons. Never executes or prepares a trade."],
];

const CALLS: { label: string; body: object }[] = [
  { label: "tools/list", body: { jsonrpc: "2.0", id: 1, method: "tools/list" } },
  { label: "assay_board", body: { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "assay_board", arguments: {} } } },
  { label: "assay_token AAPLc", body: { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "assay_token", arguments: { symbol: "AAPLc" } } } },
  { label: "check_before_trade", body: { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "check_before_trade", arguments: { symbol: "AAPLc", usd: 500, side: "buy" } } } },
  { label: "list_corporate_actions", body: { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "list_corporate_actions", arguments: {} } } },
];

export default function Agent() {
  const url = MCP_URL();
  const [out, setOut] = useState<{ label: string; text: string; ms: number; status: number } | null>(null);
  const [busy, setBusy] = useState("");

  const call = async (c: (typeof CALLS)[number]) => {
    setBusy(c.label);
    const t0 = performance.now();
    try {
      const res = await fetch("/mcp", { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify(c.body) });
      const text = await res.text();
      let pretty = text;
      try { pretty = JSON.stringify(JSON.parse(text), null, 2); } catch { /* keep raw */ }
      setOut({ label: c.label, text: pretty, ms: Math.round(performance.now() - t0), status: res.status });
    } catch (e) {
      setOut({ label: c.label, text: `request failed: ${e instanceof Error ? e.message : "network error"}`, ms: Math.round(performance.now() - t0), status: 0 });
    } finally { setBusy(""); }
  };

  return (
    <>
      <div className="page-h">
        <div>
          <h1>Agent (MCP)</h1>
          <p>A remote MCP server so an AI agent can ask Assay whether a tokenized stock's price can be trusted. All five tools are read-only. There is no tool that trades, signs or holds funds.</p>
        </div>
      </div>

      <div className="card">
        <b>Server URL</b>
        <p className="muted" style={{ fontSize: 14 }}>Streamable HTTP, stateless, no API key.</p>
        <CopyBlock text={url} />
        <h3 style={{ fontSize: 15, margin: "16px 0 6px" }}>Rate limits</h3>
        <ul className="muted" style={{ fontSize: 14, margin: 0, paddingLeft: 18 }}>
          <li><code>/mcp</code>: 60 requests per minute per IP address.</li>
          <li><code>/api/*</code>: 120 requests per minute per IP address.</li>
          <li>Enforced by Netlify&rsquo;s rate-limit rules at the edge, so the count is shared across all instances. Going over returns <b>HTTP 429</b>; wait a minute and retry.</li>
          <li>Readings refresh every 5 minutes, so polling faster than that returns the same data. Responses are cached for 10 to 30 seconds.</li>
          <li>Webhook registration is limited to 5 per minute per IP.</li>
        </ul>
      </div>

      <div className="grid-2" style={{ marginTop: 16 }}>
        <div className="card">
          <b>Claude Code</b>
          <CopyBlock text={`claude mcp add --transport http assay ${url}`} />
        </div>
        <div className="card">
          <b>Other clients (JSON config)</b>
          <CopyBlock text={JSON.stringify({ mcpServers: { assay: { type: "http", url } } }, null, 2)} />
        </div>
      </div>

      <h2 style={{ fontSize: 22, margin: "28px 0 12px" }}>Tools</h2>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Tool</th><th>Input</th><th>Returns</th></tr></thead>
          <tbody>{TOOLS.map(([n, i, d]) => <tr key={n}><td><code>{n}</code></td><td><code>{i}</code></td><td className="muted">{d}</td></tr>)}</tbody>
        </table>
      </div>

      <h2 style={{ fontSize: 22, margin: "28px 0 12px" }}>Live calls</h2>
      <p className="muted" style={{ fontSize: 14 }}>These run against the real endpoint from your browser. The response is shown exactly as returned.</p>
      <div className="chips">
        {CALLS.map((c) => <button key={c.label} className="chip" disabled={!!busy} onClick={() => void call(c)}>{busy === c.label ? "calling…" : c.label}</button>)}
      </div>
      {out && (
        <div style={{ marginTop: 14 }} aria-live="polite">
          <div className="muted mono" style={{ fontSize: 12, marginBottom: 6 }}>POST /mcp · {out.label} · HTTP {out.status} · {out.ms} ms</div>
          <pre>{out.text}</pre>
        </div>
      )}
      <p className="notice">
        What an agent should do with a verdict: <b>ok</b> means the price check passed and the size fits the pool; <b>caution</b> means slow down or reduce size; <b>avoid</b> means do not act on this price; <b>unknown</b> means Assay cannot say (no reference, no deep pool, or a reading older than 15 minutes).
      </p>
      <Disclaimer />
    </>
  );
}
