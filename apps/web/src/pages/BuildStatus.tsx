import { useEffect, useState } from "react";
import { BOARD_LATE_SEC } from "@assay/core";
import { Disclaimer } from "../components/bits";
import { ageOf, DATA_URL, fmtAge, REPO_URL, useData, useNow, type HistoryPoint, type Status } from "../lib/api";

interface Check { name: string; state: "yes" | "no" | "wait"; detail: string }

interface Run { status: string; conclusion: string | null; created_at: string; event: string }

/** Median gap (minutes) between consecutive history points: the cadence actually observed. */
function observedCadence(points: HistoryPoint[]): { median: number; max: number; n: number } | null {
  const ts = points.map((p) => Date.parse(p.t)).filter(Number.isFinite).slice(-48);
  if (ts.length < 3) return null;
  const gaps = ts.slice(1).map((t, i) => (t - ts[i]!) / 60_000).sort((a, b) => a - b);
  return { median: gaps[Math.floor(gaps.length / 2)]!, max: gaps[gaps.length - 1]!, n: gaps.length };
}

export default function BuildStatus() {
  const status = useData<Status>("status.json", 120_000);
  const hist = useData<{ points: HistoryPoint[] }>("history/AAPLc.json", 300_000);
  const now = useNow();
  const [rpc, setRpc] = useState<Check>({ name: "Base RPC (browser)", state: "wait", detail: "checking…" });
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [runsErr, setRunsErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("https://base-rpc.publicnode.com", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }) });
        const j = await r.json();
        setRpc({ name: "Base RPC (browser)", state: j.result ? "yes" : "no", detail: j.result ? `reachable from your browser, block ${parseInt(j.result, 16).toLocaleString("en-US")}` : `HTTP ${r.status}` });
      } catch (e) { setRpc({ name: "Base RPC (browser)", state: "no", detail: e instanceof Error ? e.message : "failed" }); }
      try {
        const r = await fetch("https://api.github.com/repos/ace-coderr/assay/actions/workflows/readings.yml/runs?per_page=8");
        if (!r.ok) throw new Error(`GitHub API HTTP ${r.status}`);
        setRuns(((await r.json()) as { workflow_runs: Run[] }).workflow_runs);
      } catch (e) { setRunsErr(e instanceof Error ? e.message : "failed"); }
    })();
  }, []);

  const s = status.data;
  const age = ageOf(s?.updatedAt, now);
  const cad = hist.data ? observedCadence(hist.data.points) : null;
  const live: Check[] = [
    { name: "Published readings (data branch)", state: s?.updatedAt ? (age! < BOARD_LATE_SEC ? "yes" : "no") : s ? "no" : "wait", detail: s?.updatedAt ? `newest reading ${fmtAge(age)} ago, block ${s.block}${age! >= BOARD_LATE_SEC ? ": late" : ""}` : status.error ?? "checking…" },
    { name: "Tokenized Stocks API (read by the pipeline)", state: s?.sources?.tokensApi.ok ? "yes" : s ? "no" : "wait", detail: s?.sources ? (s.sources.tokensApi.ok ? `${s.totalTokens} tokens, ${s.assayable ?? s.tracked} of ${s.tracked} reference tokens assayable` : s.sources.tokensApi.error ?? "failing") : "checking…" },
    { name: "Base RPC (read by the pipeline)", state: s?.sources?.rpc.ok ? "yes" : s ? "no" : "wait", detail: s?.sources ? (s.sources.rpc.ok ? "reading pools" : s.sources.rpc.error ?? "failing") : "checking…" },
    rpc,
    {
      name: "Observed schedule cadence",
      state: cad ? (cad.median <= 15 ? "yes" : "no") : "wait",
      detail: cad ? `median ${cad.median.toFixed(1)} min between readings, longest gap ${cad.max.toFixed(0)} min (last ${cad.n} gaps; target 10 min)` : hist.error ? `history unavailable: ${hist.error}` : "building history…",
    },
  ];

  const rows: [string, string, string][] = [
    ["Core engine (states, depth, TWAP and manipulation-cost guards)", "Done", "Unit tests run on fixtures captured from live calls; swap simulation checked against Uniswap's own quoter (docs/verification.md)."],
    ["Scheduled readings + 7 days of history", "Live", "GitHub Actions, about every 10 minutes: each run starts the next, because the cron alone fired only every few hours. Best-effort; every reading shows its real age. Published as JSON to the data branch."],
    ["Uniswap v3, Aerodrome v2 and Slipstream USDC pools", "Live", "Discovered on-chain from each factory. Slipstream holds the deepest stock pools."],
    ["Liquidity probe and Attestations", "Live", "Computed and read in your browser over public RPCs."],
    ["MCP server (5 read-only tools)", "Local", "Runs on your machine over stdio. There is no hosted endpoint."],
    ["Attestation contract", "Testnet only", "Base Sepolia. Nothing on mainnet. See the Attestations page."],
    ["Corporate-action history", "Partial", "Onchain log scan catches up from roughly two weeks back; earlier events are not covered."],
    ["Tokens without a reference value", "Not covered", "The API publishes no reference value for them, so they are not assayed."],
    ["Uniswap v4, PancakeSwap, Nami, Solidly, non-USDC pairs", "Not covered", "Checked and found much shallower than the Aerodrome pools, so they are not read. See docs/coverage.md."],
    ["Hosted API, hosted MCP endpoint, webhooks", "Not available", "A static site cannot host them; see docs/hosting.md."],
    ["Block explorer cross-check", "Not automated", "Explorer APIs need a key or block bots. Readings are verified across several RPCs instead; links to explorer pages are provided."],
    ["Trading, swaps, custody", "Never", "Out of scope by design. No endpoint, tool or button does this."],
  ];
  const cls = (v: string) => (v === "Live" || v === "Done" || v === "Local" ? "fresh" : v === "Never" || v === "Not covered" || v === "Not available" ? "drifting" : "stale");

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
      <div className="card" style={{ marginTop: 16 }}>
        <b>Recent scheduled runs</b>
        {runsErr && <p className="muted" style={{ fontSize: 13 }}>GitHub did not answer from your browser ({runsErr}). See <a href={`${REPO_URL}/actions/workflows/readings.yml`} target="_blank" rel="noreferrer">the Actions page</a>.</p>}
        {!runs && !runsErr && <p className="muted" style={{ fontSize: 13 }}>loading…</p>}
        {runs && (
          <div className="table-wrap" style={{ marginTop: 10 }}>
            <table>
              <thead><tr><th>Started</th><th>Trigger</th><th>Result</th></tr></thead>
              <tbody>
                {runs.map((r, i) => (
                  <tr key={i}>
                    <td className="mono">{r.created_at.replace("T", " ").slice(0, 19)} UTC ({fmtAge(ageOf(r.created_at, now))} ago)</td>
                    <td>{r.event === "schedule" ? "schedule" : r.event}</td>
                    <td><span className={`badge ${r.conclusion === "success" ? "fresh" : r.status !== "completed" ? "stale" : "drifting"}`}>{(r.conclusion ?? r.status).toUpperCase()}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="notice">Data comes from <code>{DATA_URL.replace("https://", "")}</code>.</p>
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
