import { Link } from "react-router-dom";
import { Strip } from "../components/Strip";
import { Disclaimer, ErrorBox, Loading, StateBadge } from "../components/bits";
import { fmtAge, fmtBps, fmtPrice, fmtUsd, useApi, type Board as BoardT } from "../lib/api";

const ORDER: Record<string, number> = { Broken: 0, Drifting: 1, Stale: 2, Fresh: 3 };

export default function Board() {
  const { data, error, loading, reload } = useApi<BoardT>("/api/board", 30_000);
  const rows = (data?.readings ?? []).slice().sort((a, b) => {
    const ra = a.status === "ok" ? ORDER[a.state!] ?? 4 : 5;
    const rb = b.status === "ok" ? ORDER[b.state!] ?? 4 : 5;
    return ra - rb || a.symbol.localeCompare(b.symbol);
  });
  const stale = data && data.ageSec > 900;
  const degraded = data && (!data.sources.tokensApi.ok || !data.sources.rpc.ok);
  return (
    <>
      <div className="page-h">
        <div>
          <h1>Board</h1>
          <p>Every token that has a published reference value, read against its deepest qualifying pool. Updated every 5 minutes.</p>
        </div>
        {data && <span className="muted mono" style={{ fontSize: 12.5 }}>updated {fmtAge(data.ageSec)} ago · block {Number(data.block ?? 0).toLocaleString("en-US")}</span>}
      </div>

      {error && <ErrorBox error={error} onRetry={reload} />}
      {degraded && (
        <div className="banner" role="alert">
          A data source is failing. {!data!.sources.tokensApi.ok && <>Tokenized Stocks API: {data!.sources.tokensApi.error}. </>}
          {!data!.sources.rpc.ok && <>Base RPC: {data!.sources.rpc.error}. </>}
          The readings below are the last known ones and are not being refreshed.
        </div>
      )}
      {stale && !degraded && <div className="banner">The latest reading is {fmtAge(data!.ageSec)} old. The scheduled refresh may be late.</div>}
      {loading && <Loading rows={6} />}

      {data && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Token</th>
                <th>State</th>
                <th className="num">DEX</th>
                <th className="num">Reference</th>
                <th className="num">Deviation</th>
                <th>Scale</th>
                <th className="num">Pool depth</th>
                <th className="num">Ref age</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.symbol}>
                  <td>
                    <Link to={`/app/token/${r.symbol}`}><b>{r.symbol}</b></Link>
                    {r.multiplier !== 1 && <div className="dim mono" style={{ fontSize: 11 }}>×{r.multiplier.toFixed(4)}</div>}
                  </td>
                  <td><StateBadge r={r} /></td>
                  {r.status === "ok" ? (
                    <>
                      <td className="num">${fmtPrice(r.dexPrice)}</td>
                      <td className="num">${fmtPrice(r.reference)}</td>
                      <td className={`num ${r.state === "Drifting" || r.state === "Broken" ? "coral" : ""}`}>{fmtBps(r.deviationBps)}</td>
                      <td className="board-strip"><Strip deviationBps={r.deviationBps} state={r.state} label={r.symbol} /></td>
                      <td className="num">{fmtUsd(r.poolUsed?.usdcDepth)}</td>
                      <td className="num">{fmtAge(r.referenceAgeSec)}</td>
                    </>
                  ) : (
                    <td colSpan={6} className="muted" style={{ fontSize: 13 }}>
                      Unavailable: {r.unavailableReason}
                      {r.poolsRejected.length > 0 && <span className="dim"> · {r.poolsRejected.length} pool(s) rejected by the depth guard</span>}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && (
        <p className="notice">
          {data.untracked} of {data.totalTokens} tokens in the Tokenized Stocks API publish no reference value, so Assay cannot assay them and does not list a number for them.
        </p>
      )}
      <Disclaimer />
    </>
  );
}
