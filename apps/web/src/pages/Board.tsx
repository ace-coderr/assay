import { Link } from "react-router-dom";
import { BOARD_LATE_SEC } from "@assay/core";
import { Strip } from "../components/Strip";
import { Disclaimer, ErrorBox, Loading, StateBadge } from "../components/bits";
import { ageOf, fmtAge, fmtBps, fmtPrice, fmtUsd, useData, useNow, type Board as BoardT } from "../lib/api";

const ORDER: Record<string, number> = { Broken: 0, Drifting: 1, Stale: 2, Fresh: 3 };

export default function Board() {
  const { data, error, loading, reload } = useData<BoardT>("board.json", 60_000);
  const now = useNow();
  const age = ageOf(data?.updatedAt, now);
  const rows = (data?.readings ?? []).slice().sort((a, b) => {
    const ra = a.status === "ok" ? ORDER[a.state!] ?? 4 : 5;
    const rb = b.status === "ok" ? ORDER[b.state!] ?? 4 : 5;
    return ra - rb || a.symbol.localeCompare(b.symbol);
  });
  const late = age != null && age > BOARD_LATE_SEC;
  const degraded = data && (!data.sources.tokensApi.ok || !data.sources.rpc.ok);
  return (
    <>
      <div className="page-h">
        <div>
          <h1>Board</h1>
          <p>Every token that has a published reference value, read against its deepest qualifying pool. Readings are produced every 10 minutes by a GitHub Actions schedule, which can run late, so check the age.</p>
        </div>
        {data && <span className="muted mono" style={{ fontSize: 12.5 }}>read {fmtAge(age)} ago · block {Number(data.block ?? 0).toLocaleString("en-US")}</span>}
      </div>

      {error && <ErrorBox error={error} onRetry={reload} />}
      {degraded && (
        <div className="banner" role="alert">
          A data source is failing. {!data!.sources.tokensApi.ok && <>Tokenized Stocks API: {data!.sources.tokensApi.error}. </>}
          {!data!.sources.rpc.ok && <>Base RPC: {data!.sources.rpc.error}. </>}
          The readings below are the last known ones and are not being refreshed.
        </div>
      )}
      {late && !degraded && (
        <div className="banner" role="status">
          The newest reading is {fmtAge(age)} old. Readings are scheduled every 10 minutes and GitHub can run the schedule late; treat prices below as that old.
        </div>
      )}
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
                <th className="num" title="USD needed to push the price 1%">Cost to move 1%</th>
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
                      <td className="num">{r.poolUsed?.costToMove100bpsUsd != null ? `${r.poolUsed.costRangeLimited ? "≥ " : ""}${fmtUsd(r.poolUsed.costToMove100bpsUsd)}` : "n/a"}</td>
                      <td className="num">{fmtAge(ageOf(r.referenceUpdatedAt, now))}</td>
                    </>
                  ) : (
                    <td colSpan={7} className="muted" style={{ fontSize: 13 }}>
                      {r.unavailableCode === "no-pool" ? "" : "Unavailable: "}{r.unavailableReason}
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
