import { useEffect, useRef, useState } from "react";
import { Disclaimer, StateBadge } from "../components/bits";
import { fmtBps, fmtPrice, useApi, type Board } from "../lib/api";

const KEY = "assay.watchlist.v1";
interface Alert { t: string; symbol: string; msg: string }

const load = (): { symbols: string[]; threshold: number } => {
  try {
    const j = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (j && Array.isArray(j.symbols)) return { symbols: j.symbols, threshold: Number(j.threshold) || 100 };
  } catch { /* storage unavailable */ }
  return { symbols: [], threshold: 100 };
};

export default function Watchlist() {
  const board = useApi<Board>("/api/board", 60_000);
  const [{ symbols, threshold }, setCfg] = useState(load);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const last = useRef<Record<string, string>>({});
  const [perm, setPerm] = useState<string>(typeof Notification === "undefined" ? "unsupported" : Notification.permission);
  const [hook, setHook] = useState({ url: "", busy: false, result: "", error: "" });

  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify({ symbols, threshold })); } catch { /* ignore */ } }, [symbols, threshold]);

  useEffect(() => {
    if (!board.data) return;
    const fresh: Alert[] = [];
    for (const r of board.data.readings) {
      if (!symbols.includes(r.symbol)) continue;
      const key = r.status === "ok" ? `${r.state}` : "unavailable";
      const prev = last.current[r.symbol];
      const over = r.status === "ok" && Math.abs(r.deviationBps!) > threshold;
      const k2 = key + (over ? "!" : "");
      if (prev !== undefined && prev !== k2) {
        const msg = r.status === "ok" ? `${r.symbol} is now ${r.state} (${fmtBps(r.deviationBps)})` : `${r.symbol} became unavailable: ${r.unavailableReason}`;
        fresh.push({ t: new Date().toLocaleTimeString(), symbol: r.symbol, msg });
        if (typeof Notification !== "undefined" && Notification.permission === "granted") new Notification("Assay", { body: msg });
      }
      last.current[r.symbol] = k2;
    }
    if (fresh.length) setAlerts((a) => [...fresh, ...a].slice(0, 30));
  }, [board.data, symbols, threshold]);

  const toggle = (s: string) => setCfg((c) => ({ ...c, symbols: c.symbols.includes(s) ? c.symbols.filter((x) => x !== s) : [...c.symbols, s] }));
  const watched = board.data?.readings.filter((r) => symbols.includes(r.symbol)) ?? [];

  const register = async () => {
    setHook((h) => ({ ...h, busy: true, result: "", error: "" }));
    try {
      const res = await fetch("/api/webhooks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: hook.url, symbols }) });
      const j = await res.json();
      if (!res.ok) setHook((h) => ({ ...h, busy: false, error: j.error ?? `HTTP ${res.status}` }));
      else setHook((h) => ({ ...h, busy: false, result: `id: ${j.id}\nsecret: ${j.secret}\n${j.note}` }));
    } catch (e) { setHook((h) => ({ ...h, busy: false, error: e instanceof Error ? e.message : "failed" })); }
  };

  return (
    <>
      <div className="page-h">
        <div>
          <h1>Watchlist &amp; alerts</h1>
          <p>Choose tokens to watch. Alerts fire in this browser while the page is open, by webhook when a state changes, or through an RSS feed.</p>
        </div>
      </div>

      <div className="card">
        <b>Tokens</b>
        <div className="chips" style={{ marginTop: 10 }}>
          {board.data?.readings.map((r) => (
            <button key={r.symbol} className={`chip ${symbols.includes(r.symbol) ? "on" : ""}`} aria-pressed={symbols.includes(r.symbol)} onClick={() => toggle(r.symbol)}>{r.symbol}</button>
          ))}
          {board.loading && <span className="muted">loading…</span>}
          {board.error && <span className="coral">Board unavailable: {board.error}</span>}
        </div>
        <div className="row" style={{ marginTop: 16 }}>
          <label>Alert when deviation exceeds (bps)
            <input type="number" min={10} max={2000} value={threshold} onChange={(e) => setCfg((c) => ({ ...c, threshold: Number(e.target.value) || 100 }))} style={{ width: 150 }} />
          </label>
          <button className="btn" disabled={perm === "unsupported" || perm === "granted"} onClick={async () => setPerm(await Notification.requestPermission())}>
            {perm === "granted" ? "Browser notifications on" : perm === "denied" ? "Notifications blocked in browser" : perm === "unsupported" ? "Notifications unsupported" : "Enable browser notifications"}
          </button>
        </div>
        <p className="notice">Your selection is stored only in this browser (localStorage). Browser alerts need this tab open.</p>
      </div>

      <div className="grid-2" style={{ marginTop: 16 }}>
        <div className="card">
          <b>Watching</b>
          {watched.length === 0 ? <p className="muted" style={{ margin: "8px 0 0" }}>Nothing selected yet.</p> : (
            <div className="list" style={{ marginTop: 10 }}>
              {watched.map((r) => (
                <div className="item" key={r.symbol} style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                  <b>{r.symbol}</b>
                  <span className="mono muted" style={{ fontSize: 13 }}>{r.status === "ok" ? `$${fmtPrice(r.dexPrice)} · ${fmtBps(r.deviationBps)}` : "unavailable"}</span>
                  <StateBadge r={r} />
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="card" aria-live="polite">
          <b>Alerts this session</b>
          {alerts.length === 0 ? <p className="muted" style={{ margin: "8px 0 0" }}>No changes yet. The board is checked every minute.</p> : (
            <div className="list" style={{ marginTop: 10 }}>{alerts.map((a, i) => <div className="item" key={i}><span className="dim mono" style={{ fontSize: 12 }}>{a.t}</span> {a.msg}</div>)}</div>
          )}
        </div>
      </div>

      <div className="grid-2" style={{ marginTop: 16 }}>
        <div className="card">
          <b>Webhook</b>
          <p className="muted" style={{ fontSize: 14 }}>
            Assay POSTs state changes for the tokens above to your HTTPS URL, signed with HMAC-SHA256 (header <code>x-assay-signature</code>, key is the SHA-256 of your secret). Private and non-HTTPS addresses are refused.
          </p>
          <form className="row" onSubmit={(e) => { e.preventDefault(); void register(); }}>
            <label style={{ flex: 1 }}>HTTPS URL
              <input type="url" required placeholder="https://example.com/assay-hook" value={hook.url} onChange={(e) => setHook((h) => ({ ...h, url: e.target.value }))} />
            </label>
            <button className="btn primary" disabled={hook.busy}>{hook.busy ? "Registering…" : "Register"}</button>
          </form>
          {hook.error && <p className="coral" role="alert" style={{ fontSize: 13 }}>{hook.error}</p>}
          {hook.result && <pre style={{ marginTop: 10 }}>{hook.result}</pre>}
          <p className="notice">With no tokens selected, the webhook receives every state change.</p>
        </div>
        <div className="card">
          <b>RSS</b>
          <p className="muted" style={{ fontSize: 14 }}>Every Fresh / Stale / Drifting / Broken transition as an RSS item. Add it to any feed reader.</p>
          <a className="btn" href="/api/feed.xml">/api/feed.xml</a>
        </div>
      </div>
      <Disclaimer />
    </>
  );
}
