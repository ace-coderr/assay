import { useState } from "react";
import { Disclaimer, ErrorBox, Loading } from "../components/bits";
import { explorerTx, short, useApi, type ActionEvent } from "../lib/api";

interface Resp {
  actions: ActionEvent[];
  note: string;
  cursor: { block: string; head: string } | null;
  scanError: { at: string; error: string } | null;
}

function Detail({ id }: { id: string }) {
  const [state, setState] = useState<{ loading: boolean; body?: string; error?: string }>({ loading: false });
  return (
    <div style={{ marginTop: 8 }}>
      <button
        className="btn small"
        disabled={state.loading}
        onClick={async () => {
          setState({ loading: true });
          try {
            const res = await fetch(`/api/actions/${id}`);
            const txt = await res.text();
            setState({ loading: false, body: res.ok ? JSON.stringify(JSON.parse(txt), null, 2) : undefined, error: res.ok ? undefined : `issuer record unavailable (HTTP ${res.status})` });
          } catch (e) {
            setState({ loading: false, error: e instanceof Error ? e.message : "failed" });
          }
        }}
      >
        {state.loading ? "Loading…" : "Load issuer record"}
      </button>
      {state.error && <p className="coral" style={{ fontSize: 13 }}>{state.error}</p>}
      {state.body && <pre style={{ marginTop: 8 }}>{state.body}</pre>}
    </div>
  );
}

export default function Actions() {
  const { data, error, loading, reload } = useApi<Resp>("/api/actions", 60_000);
  const scanned = data?.cursor ? Number(data.cursor.block) : null;
  const head = data?.cursor ? Number(data.cursor.head) : null;
  return (
    <>
      <div className="page-h">
        <div>
          <h1>Corporate actions</h1>
          <p>Splits, dividends and other events change a token's multiplier. Assay watches the onchain announcements and flags any multiplier change between readings, because a price comparison is not valid while one is in progress.</p>
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
                  {a.actionId && <Detail id={a.actionId} />}
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
