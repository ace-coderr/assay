import { useEffect, useState } from "react";
import { Disclaimer } from "../components/bits";
import { fmtAge, useApi, type Status } from "../lib/api";

interface Check { name: string; state: "yes" | "no" | "wait"; detail: string }

export default function BuildStatus() {
  const status = useApi<Status>("/api/status", 30_000);
  const [mcp, setMcp] = useState<Check>({ name: "Remote MCP server", state: "wait", detail: "checking…" });
  const [feed, setFeed] = useState<Check>({ name: "RSS feed", state: "wait", detail: "checking…" });

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/mcp", { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
        const j = await r.json();
        const n = j?.result?.tools?.length;
        setMcp({ name: "Remote MCP server", state: n ? "yes" : "no", detail: n ? `responding, ${n} read-only tools` : `HTTP ${r.status}` });
      } catch (e) { setMcp({ name: "Remote MCP server", state: "no", detail: e instanceof Error ? e.message : "failed" }); }
      try {
        const r = await fetch("/api/feed.xml");
        setFeed({ name: "RSS feed", state: r.ok ? "yes" : "no", detail: r.ok ? "serving" : `HTTP ${r.status}` });
      } catch { setFeed({ name: "RSS feed", state: "no", detail: "unreachable" }); }
    })();
  }, []);

  const s = status.data;
  const live: Check[] = [
    { name: "API and scheduled readings", state: s?.updatedAt && (s.ageSec ?? 1e9) < 900 ? "yes" : s ? "no" : "wait", detail: s?.updatedAt ? `last reading ${fmtAge(s.ageSec)} ago, block ${s.block}` : status.error ?? "checking…" },
    { name: "Tokenized Stocks API", state: s?.sources?.tokensApi.ok ? "yes" : s ? "no" : "wait", detail: s?.sources ? (s.sources.tokensApi.ok ? `${s.totalTokens} tokens, ${s.tracked} with a reference value` : s.sources.tokensApi.error ?? "failing") : "checking…" },
    { name: "Base RPC (pool reads)", state: s?.sources?.rpc.ok ? "yes" : s ? "no" : "wait", detail: s?.sources ? (s.sources.rpc.ok ? "reading pools" : s.sources.rpc.error ?? "failing") : "checking…" },
    mcp,
    feed,
  ];

  const rows: [string, string, string][] = [
    ["Core engine (states, depth and TWAP guards)", "Done", "Unit tests run on fixtures captured from live calls."],
    ["Scheduled readings + history", "Live", "Every 5 minutes on Netlify, stored in Netlify Blobs. Independent of any developer machine."],
    ["Read-only API, RSS, signed webhooks", "Live", "Rate limited per client; webhook URLs are checked against private addresses."],
    ["MCP server (5 tools)", "Live", "Streamable HTTP, stateless, read-only."],
    ["Attestation contract", "Testnet only", "Base Sepolia. Nothing on mainnet. See the Attestations page for its deployed state."],
    ["Corporate-action history", "Partial", "Onchain log scan catches up from roughly two weeks back; earlier events are not covered."],
    ["Tokens without a reference value (306)", "Not covered", "The API publishes no reference value, so they are not assayed."],
    ["Uniswap v3, Aerodrome v2 and Slipstream USDC pools", "Live", "Discovered on-chain from each factory. Slipstream holds the deepest stock pools."],
    ["Uniswap v4, PancakeSwap, Nami, Solidly, non-USDC pairs", "Not covered", "Checked and found much shallower than the Aerodrome pools, so they are not read. See docs/coverage.md."],
    ["Block explorer cross-check", "Not automated", "Explorer APIs need a key or block bots. Readings are verified across two RPCs instead; links to explorer pages are provided."],
    ["Trading, swaps, custody", "Never", "Out of scope by design. No endpoint, tool or button does this."],
  ];
  const cls = (v: string) => (v === "Live" || v === "Done" ? "fresh" : v === "Never" || v === "Not covered" ? "drifting" : "stale");

  return (
    <>
      <div className="page-h"><div><h1>Build status</h1><p>What is running right now, checked live from your browser, and what is not built.</p></div></div>
      <div className="card">
        <b>Live checks</b>
        <div className="list" style={{ marginTop: 12 }}>
          {live.map((c) => (
            <div className="item" key={c.name} style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <span><span className={`live-dot ${c.state === "no" ? "off" : ""}`} style={c.state === "wait" ? { background: "var(--dim)", animation: "none" } : {}} /> {c.name}</span>
              <span className="muted mono" style={{ fontSize: 12.5 }}>{c.detail}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="table-wrap" style={{ marginTop: 16 }}>
        <table>
          <thead><tr><th>Component</th><th>Status</th><th>Notes</th></tr></thead>
          <tbody>
            {rows.map(([a, b, c]) => (
              <tr key={a}><td>{a}</td><td><span className={`badge ${cls(b)}`}>{b.toUpperCase()}</span></td><td className="muted">{c}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <Disclaimer />
    </>
  );
}
