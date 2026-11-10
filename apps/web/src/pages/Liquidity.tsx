import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Disclaimer, ErrorBox } from "../components/bits";
import { explorer, fmtPrice, fmtUsd, useApi, type Board } from "../lib/api";

interface Probe {
  ok: boolean;
  error?: string;
  symbol?: string;
  readAt?: string;
  pool?: { address: string; venue: string; feeBps?: number; usdcDepth: number; spotPrice: number };
  quote?: { slippageBps: number | null; lowerBound: boolean; feeBps: number; note?: string };
  method?: string;
  rejectedPools?: { pool: string; why: string }[];
}

const SIZES = [100, 1000, 5000, 25000];

export default function Liquidity() {
  const [sp, setSp] = useSearchParams();
  const board = useApi<Board>("/api/board");
  const symbols = board.data?.readings.filter((r) => r.status === "ok").map((r) => r.symbol) ?? [];
  const [symbol, setSymbol] = useState(sp.get("symbol") ?? "");
  const [usd, setUsd] = useState("1000");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [res, setRes] = useState<Probe | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (!symbol && symbols[0]) setSymbol(symbols[0]); }, [symbols.join(","), symbol]);

  const run = async () => {
    setBusy(true); setErr(null); setRes(null);
    try {
      const r = await fetch(`/api/probe?symbol=${encodeURIComponent(symbol)}&usd=${encodeURIComponent(usd)}&side=${side}`);
      const j = (await r.json()) as Probe;
      if (!r.ok || j.ok === false) setErr(j.error ?? `HTTP ${r.status}`); else setRes(j);
      setSp({ symbol });
    } catch (e) { setErr(e instanceof Error ? e.message : "network error"); }
    finally { setBusy(false); }
  };

  const q = res?.quote;
  return (
    <>
      <div className="page-h">
        <div>
          <h1>Liquidity probe</h1>
          <p>What a trade of a given size would cost in the deepest qualifying pool. This is a read-only estimate. Assay does not build, sign or send any transaction, and there is no swap control here.</p>
        </div>
      </div>
      <div className="card">
        <form className="row" onSubmit={(e) => { e.preventDefault(); void run(); }}>
          <label>Token
            <select value={symbol} onChange={(e) => setSymbol(e.target.value)} aria-label="Token">
              {symbols.map((s) => <option key={s}>{s}</option>)}
            </select>
          </label>
          <label>Size (USD)
            <input inputMode="decimal" value={usd} onChange={(e) => setUsd(e.target.value)} aria-label="Size in USD" style={{ width: 130 }} />
          </label>
          <label>Direction
            <select value={side} onChange={(e) => setSide(e.target.value as "buy" | "sell")} aria-label="Direction">
              <option value="buy">Buy into the pool</option>
              <option value="sell">Sell into the pool</option>
            </select>
          </label>
          <button className="btn primary" type="submit" disabled={busy || !symbol}>{busy ? "Reading…" : "Estimate cost"}</button>
        </form>
        <div className="chips" style={{ marginTop: 12 }}>
          {SIZES.map((s) => <button type="button" key={s} className={`chip ${usd === String(s) ? "on" : ""}`} onClick={() => setUsd(String(s))}>{fmtUsd(s)}</button>)}
        </div>
      </div>
      {board.error && <ErrorBox error={board.error} onRetry={board.reload} />}
      {err && <div className="banner" role="alert" style={{ marginTop: 16 }}>{err}</div>}
      {res && q && (
        <div className="card" style={{ marginTop: 16 }} aria-live="polite">
          <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
            <div>
              <div className="dim" style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: ".08em" }}>Estimated cost vs spot</div>
              <div style={{ fontSize: 40, fontWeight: 700, letterSpacing: "-0.02em" }} className={q.slippageBps != null && q.slippageBps > 100 ? "coral" : ""}>
                {q.slippageBps == null ? "n/a" : `${q.lowerBound ? "≥ " : ""}${q.slippageBps.toFixed(0)} bps`}
              </div>
              <div className="muted" style={{ fontSize: 14 }}>
                {q.slippageBps == null ? q.note : `${fmtUsd(Number(usd))} ${side}, fee ${q.feeBps} bps included`}
              </div>
            </div>
            <dl className="kv" style={{ alignContent: "start" }}>
              <dt>Pool</dt><dd><a href={explorer(res.pool!.address)} target="_blank" rel="noreferrer">{res.pool!.address.slice(0, 10)}…</a> ({res.pool!.venue})</dd>
              <dt>Depth</dt><dd>{fmtUsd(res.pool!.usdcDepth)} USDC</dd>
              <dt>Spot</dt><dd>${fmtPrice(res.pool!.spotPrice, 4)}</dd>
              <dt>Reading</dt><dd>{res.readAt}</dd>
            </dl>
          </div>
          {q.lowerBound && (
            <p className="banner" style={{ marginTop: 14 }}>
              This size is larger than the liquidity at the pool's current price range. The true cost is higher than shown, because the trade would move through further price ranges. Assay does not simulate those.
            </p>
          )}
          <p className="notice">{res.method}</p>
          {res.rejectedPools && res.rejectedPools.length > 0 && (
            <details>
              <summary className="muted" style={{ cursor: "pointer", fontSize: 13 }}>{res.rejectedPools.length} other pool(s) ignored by the depth guard</summary>
              <ul style={{ fontSize: 13, color: "var(--muted)" }}>{res.rejectedPools.map((p) => <li key={p.pool}>{p.pool.slice(0, 10)}…: {p.why}</li>)}</ul>
            </details>
          )}
        </div>
      )}
      <Disclaimer />
    </>
  );
}
