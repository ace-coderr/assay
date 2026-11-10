import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { findReading, parseSize, probe, VENUE_LABEL, type Reading, type Venue } from "@assay/core";
import { Disclaimer, ErrorBox } from "../components/bits";
import { ageOf, explorer, fmtAge, fmtPrice, fmtUsd, useData, useNow, type Board } from "../lib/api";
import { liveReading } from "../lib/live";

const SIZES = [100, 1000, 5000, 25000];

export default function Liquidity() {
  const [sp, setSp] = useSearchParams();
  const board = useData<Board>("board.json", 120_000);
  const now = useNow();
  const symbols = board.data?.readings.filter((r) => r.status === "ok").map((r) => r.symbol) ?? [];
  const [symbol, setSymbol] = useState(sp.get("symbol") ?? "");
  const [usd, setUsd] = useState("1000");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [live, setLive] = useState<Reading | null>(null);
  const [liveBusy, setLiveBusy] = useState(false);
  const [liveErr, setLiveErr] = useState<string | null>(null);

  useEffect(() => { if (!symbol && symbols[0]) setSymbol(symbols[0]); }, [symbols.join(","), symbol]);
  useEffect(() => { setLive(null); setLiveErr(null); }, [symbol]);

  const published = board.data ? findReading(board.data, symbol) : undefined;
  const reading = live ?? published;
  const size = parseSize(usd);
  const result = useMemo(() => (reading && typeof size === "number" ? probe(reading, symbol, size, side) : null), [reading, symbol, size, side]);

  const reread = async () => {
    if (!published) return;
    setLiveBusy(true); setLiveErr(null);
    try { setLive(await liveReading(published)); } catch (e) { setLiveErr(e instanceof Error ? e.message : "RPC error"); } finally { setLiveBusy(false); }
  };

  const q = result && result.ok ? result.quote : null;
  return (
    <>
      <div className="page-h">
        <div>
          <h1>Liquidity probe</h1>
          <p>What a trade of a given size would cost in the deepest qualifying pool. This is a read-only estimate computed in your browser. Assay does not build, sign or send any transaction, and there is no swap control here.</p>
        </div>
      </div>
      <div className="card">
        <form className="row" onSubmit={(e) => { e.preventDefault(); setSp({ symbol }); }}>
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
          <button className="btn" type="button" onClick={() => void reread()} disabled={liveBusy || !published || published.status !== "ok"}>{liveBusy ? "Reading chain…" : "Re-read pool on-chain now"}</button>
        </form>
        <div className="chips" style={{ marginTop: 12 }}>
          {SIZES.map((s) => <button type="button" key={s} className={`chip ${usd === String(s) ? "on" : ""}`} onClick={() => setUsd(String(s))}>{fmtUsd(s)}</button>)}
        </div>
        {reading && (
          <p className="notice" aria-live="polite">
            {live
              ? <>Pool state read live from the Base RPC just now (block {Number(live.block).toLocaleString("en-US")}).</>
              : <>Using the published reading from {fmtAge(ageOf(published?.readAt, now))} ago. Use &ldquo;Re-read pool on-chain now&rdquo; for the pool as it is this second.</>}
          </p>
        )}
      </div>
      {board.error && <ErrorBox error={board.error} onRetry={board.reload} />}
      {liveErr && <div className="banner" role="alert" style={{ marginTop: 16 }}>Live read failed: {liveErr}. The published reading is still shown.</div>}
      {typeof size === "object" && <div className="banner" role="alert" style={{ marginTop: 16 }}>{size.error}</div>}
      {result && !result.ok && <div className="banner" role="alert" style={{ marginTop: 16 }}>{result.error}</div>}
      {result && result.ok && q && (
        <div className="card" style={{ marginTop: 16 }} aria-live="polite">
          <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
            <div>
              <div className="dim" style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: ".08em", display: "flex", gap: 8, alignItems: "center" }}>
                {q.lowerBound ? "Cost vs spot" : "Estimated cost vs spot"}
                {q.lowerBound && <span className="badge drifting" title="The real cost is higher than this number">AT LEAST</span>}
              </div>
              <div style={{ fontSize: 40, fontWeight: 700, letterSpacing: "-0.02em" }} className={q.slippageBps != null && q.slippageBps > 100 ? "coral" : ""}>
                {q.slippageBps == null ? "n/a" : `${q.lowerBound ? "≥ " : ""}${q.slippageBps.toFixed(0)} bps`}
              </div>
              <div className="muted" style={{ fontSize: 14 }}>
                {q.slippageBps == null ? q.note : `${fmtUsd(Number(usd))} ${side}, fee ${q.feeBps} bps included`}
              </div>
              {q.lowerBound && (
                <div className="coral" style={{ fontSize: 13.5, marginTop: 6, maxWidth: 460 }} role="note">
                  &ldquo;At least&rdquo; means this size is bigger than the liquidity at the pool&rsquo;s current price, so the true cost is higher than shown.
                </div>
              )}
            </div>
            <dl className="kv" style={{ alignContent: "start" }}>
              <dt>Pool</dt><dd><a href={explorer(result.pool.address)} target="_blank" rel="noreferrer">{result.pool.address.slice(0, 10)}…</a> ({VENUE_LABEL[result.pool.venue as Venue] ?? result.pool.venue})</dd>
              <dt>Depth</dt><dd>{fmtUsd(result.pool.usdcDepth)} USDC</dd>
              <dt>Spot</dt><dd>${fmtPrice(result.pool.spotPrice, 4)}</dd>
              <dt>Reading</dt><dd>{result.readAt}</dd>
            </dl>
          </div>
          {q.lowerBound && (
            <p className="banner" style={{ marginTop: 14 }}>
              This size needs more liquidity than Assay read around the current price (about 3% each side). The true cost is higher than shown, and Assay does not guess how much higher.
            </p>
          )}
          <p className="notice">{result.method}</p>
          {result.rejectedPools && result.rejectedPools.length > 0 && (
            <details>
              <summary className="muted" style={{ cursor: "pointer", fontSize: 13 }}>{result.rejectedPools.length} other pool(s) ignored by the guards</summary>
              <ul style={{ fontSize: 13, color: "var(--muted)" }}>{result.rejectedPools.map((p) => <li key={p.pool}>{p.pool.slice(0, 10)}…: {p.why}</li>)}</ul>
            </details>
          )}
        </div>
      )}
      <Disclaimer />
    </>
  );
}
