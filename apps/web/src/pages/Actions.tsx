import { useState } from "react";
import { Disclaimer, ErrorBox, Loading } from "../components/bits";
import { explorerTx, short, useData, type ActionEvent } from "../lib/api";

type Detail = { status: "ok"; record: unknown; fetchedAt: string } | { status: "unavailable"; reason: string; fetchedAt: string };

interface Resp {
  actions: ActionEvent[];
  details: Record<string, Detail>;
  note: string;
  cursor: { block: string; head: string } | null;
  scanError: { at: string; error: string } | null;
}

function IssuerRecord({ id, detail }: { id: string; detail?: Detail }) {
  const [open, setOpen] = useState(false);
  if (!detail) return <p className="dim" style={{ fontSize: 13, margin: "8px 0 0" }}>Issuer record not fetched yet; the next scheduled run will try.</p>;
  if (detail.status === "unavailable") return <p className="coral" style={{ fontSize: 13, margin: "8px 0 0" }}>Issuer record unavailable: {detail.reason}.</p>;
  return (
    <div style={{ marginTop: 8 }}>
      <button className="btn small" aria-expanded={open} onClick={() => setOpen((o) => !o)}>{open ? "Hide issuer record" : "Show issuer record"}</button>
      {open && <pre style={{ marginTop: 8 }} aria-label={`Issuer record ${id}`}>{JSON.stringify(detail.record, null, 2)}</pre>}
    </div>
  );
}

export default function Actions() {
  const { data, error, loading, reload } = useData<Resp>("actions.json", 120_000);
  const scanned = data?.cursor ? Number(data.cursor.block) : null;
  const head = data?.cursor ? Number(data.cursor.head) : null;
  return (
    <>
      <div className="page-h">
        <div>
          <h1>Corporate actions</h1>
          <p>Splits, dividends and other events change a token&rsquo;s multiplier. Assay watches the onchain announcements and flags any multiplier change between readings, because a price comparison is not valid while one is in progress.</p>
        </div>
      </div>
      {loading && <Loading />}
      {error && <ErrorBox error={error} onRetry={reload} />}
      {data?.scanError && <div className="banner">Last log scan failed: {data.scanError.error}</div>}
      {data && (
        <>
          <p className="notice">
            {data.note} {scanned && head ? `Scanned through block ${scanned.toLocaleString("en-US")} of ${head.toLocaleString("en-US")}${scanned < head - 1000 ? " (still catching up)" : ""}.` : ""}
          </p>
          {data.actions.length === 0 ? (
            <div className="card">
              <b>No corporate actions seen yet.</b>
              <p className="muted" style={{ margin: "6px 0 0" }}>
                None of the watched tokens has announced one in the scanned range. An empty list is a real result, not a missing feed.
              </p>
            </div>
          ) : (
            <div className="list">
              {data.actions.map((a, i) => (
                <div className="item" key={i}>
                  <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    <b>{a.symbol}</b>
                    <span className="badge">{a.kind}</span>
                    {a.tx && <a className="mono" style={{ fontSize: 12 }} href={explorerTx(a.tx)} target="_blank" rel="noreferrer">{short(a.tx)}</a>}
                    {a.block && <span className="dim mono" style={{ fontSize: 12 }}>block {Number(a.block).toLocaleString("en-US")}</span>}
                  </div>
                  {a.description && <p style={{ margin: "8px 0 0" }}>{a.description}</p>}
                  {a.new != null && (
                    <p className="mono muted" style={{ margin: "6px 0 0", fontSize: 13 }}>
                      multiplier {a.old} → {a.new}{a.effectiveAt ? ` · effective ${a.effectiveAt}` : ""}
                    </p>
                  )}
                  {a.actionId && <IssuerRecord id={a.actionId} detail={data.details?.[a.actionId]} />}
                </div>
              ))}
            </div>
          )}
        </>
      )}
      <Disclaimer />
    </>
  );
}
