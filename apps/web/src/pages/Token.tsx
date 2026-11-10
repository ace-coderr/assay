import { Link, useParams } from "react-router-dom";
import { Strip } from "../components/Strip";
import { Disclaimer, ErrorBox, Loading, StateBadge } from "../components/bits";
import { explorer, fmtAge, fmtBps, fmtPrice, fmtUsd, short, useApi, type ActionEvent, type Board, type HistoryPoint, type Reading } from "../lib/api";

interface TokenResp {
  reading: Reading;
  history: HistoryPoint[];
  actions: ActionEvent[];
  ageSec: number;
}

function Spark({ pts }: { pts: HistoryPoint[] }) {
  if (pts.length < 2) return <p className="muted" style={{ fontSize: 13 }}>History is still building: {pts.length} point so far.</p>;
  const w = 600, h = 120, p = 8;
  const vals = pts.map((x) => x.devBps);
  const max = Math.max(150, ...vals.map(Math.abs));
  const X = (i: number) => p + (i / (pts.length - 1)) * (w - 2 * p);
  const Y = (v: number) => h / 2 - (v / max) * (h / 2 - p);
  const d = pts.map((pt, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(pt.devBps).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Deviation history in basis points" style={{ width: "100%", height: "auto" }}>
      <rect x={p} y={Y(100)} width={w - 2 * p} height={Y(-100) - Y(100)} fill="var(--blue-soft)" />
      <line x1={p} x2={w - p} y1={h / 2} y2={h / 2} stroke="var(--line-2)" />
      <path d={d} fill="none" stroke="var(--blue-hi)" strokeWidth="1.8" strokeLinejoin="round" />
      <text x={w - p} y={12} textAnchor="end" fill="var(--dim)" fontSize="10" fontFamily="var(--mono)">±{max.toFixed(0)} bps · {pts.length} readings</text>
    </svg>
  );
}

export default function Token() {
  const { symbol } = useParams();
  const board = useApi<Board>(symbol ? null : "/api/board");
  const { data, error, loading, reload } = useApi<TokenResp>(symbol ? `/api/token/${encodeURIComponent(symbol)}` : null, 30_000);

  if (!symbol) {
    return (
      <>
        <div className="page-h"><div><h1>Token report</h1><p>Pick a token to see its full reading, history and pool detail.</p></div></div>
        {board.loading && <Loading />}
        {board.error && <ErrorBox error={board.error} onRetry={board.reload} />}
        <div className="chips">
          {board.data?.readings.map((r) => (
            <Link key={r.symbol} className="chip" to={`/app/token/${r.symbol}`}>{r.symbol}</Link>
          ))}
        </div>
      </>
    );
  }

  const r = data?.reading;
  return (
    <>
      <div className="page-h">
        <div>
          <h1>{r?.symbol ?? symbol}</h1>
          <p>{r ? "Latest reading with the inputs it was built from." : "Loading the latest reading."}</p>
        </div>
        {r && <StateBadge r={r} />}
      </div>
      {loading && <Loading />}
      {error && <ErrorBox error={error} onRetry={reload} />}
      {r && (
        <>
          {r.status !== "ok" ? (
            <div className="banner" role="status">
              Unavailable: {r.unavailableReason}. Assay shows no price for this token rather than guessing.
              {r.poolsRejected.length > 0 && <ul>{r.poolsRejected.map((p) => <li key={p.pool}><a href={explorer(p.pool)} target="_blank" rel="noreferrer">{short(p.pool)}</a>: {p.why}</li>)}</ul>}
            </div>
          ) : (
            <>
              <div className="card" style={{ marginBottom: 16 }}>
                <Strip deviationBps={r.deviationBps} state={r.state} label={r.symbol} />
                <ul style={{ margin: "10px 0 0", paddingLeft: 18, color: "var(--muted)", fontSize: 14 }}>
                  {r.reasons.map((x, i) => <li key={i}>{x}</li>)}
                </ul>
              </div>
              <div className="grid-2">
                <div className="card">
                  <h3 style={{ fontSize: 16, marginBottom: 12 }}>Reading</h3>
                  <dl className="kv">
                    <dt>DEX price</dt><dd>${fmtPrice(r.dexPrice, 4)}</dd>
                    <dt>Reference</dt><dd>${fmtPrice(r.reference, 4)}</dd>
                    <dt>Deviation</dt><dd className={r.state === "Drifting" || r.state === "Broken" ? "coral" : ""}>{fmtBps(r.deviationBps)}</dd>
                    <dt>Multiplier</dt><dd>{r.multiplier}</dd>
                    <dt>Underlying share</dt><dd>${fmtPrice(r.underlyingPrice, 4)}</dd>
                    <dt>Reference age</dt><dd>{fmtAge(r.referenceAgeSec)} ({r.referenceUpdatedAt})</dd>
                    <dt>30m TWAP</dt><dd>{r.poolUsed?.twapPrice ? `$${fmtPrice(r.poolUsed.twapPrice, 4)}` : "not available for this pool"}</dd>
                    <dt>Block</dt><dd>{r.block}</dd>
                  </dl>
                </div>
                <div className="card">
                  <h3 style={{ fontSize: 16, marginBottom: 12 }}>Pool used</h3>
                  <dl className="kv">
                    <dt>Venue</dt><dd>{r.poolUsed?.venue}{r.poolUsed?.feeBps != null ? ` · ${(r.poolUsed.feeBps / 100).toFixed(2)}% fee` : ""}</dd>
                    <dt>Address</dt><dd><a href={explorer(r.poolUsed!.pool)} target="_blank" rel="noreferrer">{r.poolUsed!.pool}</a></dd>
                    <dt>USDC depth</dt><dd>{fmtUsd(r.poolUsed?.usdcDepth)}</dd>
                    <dt>Cost to move 1%</dt>
                    <dd>{r.poolUsed?.costToMove100bpsUsd != null ? `${r.poolUsed.costRangeLimited ? "≥ " : ""}${fmtUsd(r.poolUsed.costToMove100bpsUsd)}` : "n/a (constant-product pool)"}</dd>
                    <dt>Pools found</dt><dd>{r.poolsConsidered} ({r.poolsRejected.length} rejected)</dd>
                  </dl>
                  {r.poolsRejected.length > 0 && (
                    <details style={{ marginTop: 12 }}>
                      <summary className="muted" style={{ cursor: "pointer", fontSize: 13 }}>Why pools were rejected</summary>
                      <ul style={{ fontSize: 13, color: "var(--muted)" }}>
                        {r.poolsRejected.map((p) => <li key={p.pool}><a href={explorer(p.pool)} target="_blank" rel="noreferrer">{short(p.pool)}</a>: {p.why}</li>)}
                      </ul>
                    </details>
                  )}
                </div>
              </div>
              <div className="card" style={{ marginTop: 16 }}>
                <h3 style={{ fontSize: 16, marginBottom: 10 }}>Deviation history</h3>
                <Spark pts={data!.history} />
              </div>
              <p className="notice">
                Want to check this yourself? <Link to={`/app/method?symbol=${r.symbol}`}>Reproduce this reading</Link> from a public RPC, or <Link to={`/app/liquidity?symbol=${r.symbol}`}>probe what a size would cost</Link>.
              </p>
            </>
          )}
          {data!.actions.length > 0 && (
            <div className="card" style={{ marginTop: 16 }}>
              <h3 style={{ fontSize: 16, marginBottom: 10 }}>Recent corporate actions</h3>
              <div className="list">
                {data!.actions.map((a, i) => (
                  <div className="item" key={i}>
                    <b>{a.kind}</b> {a.description && <span className="muted">· {a.description}</span>}
                    {a.new != null && <div className="mono muted" style={{ fontSize: 12.5 }}>multiplier {a.old} → {a.new}</div>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
      <Disclaimer />
    </>
  );
}
