import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { fmtAge, useApi, type Status } from "../lib/api";
import { DISCLAIMER_TEXT } from "./bits";

export const MODULES = [
  { n: "01", to: "/app", label: "Board", end: true },
  { n: "02", to: "/app/token", label: "Token report" },
  { n: "03", to: "/app/actions", label: "Corporate actions" },
  { n: "04", to: "/app/liquidity", label: "Liquidity probe" },
  { n: "05", to: "/app/watchlist", label: "Watchlist & alerts" },
  { n: "06", to: "/app/agent", label: "Agent (MCP)" },
  { n: "07", to: "/app/attestations", label: "Attestations" },
  { n: "08", to: "/app/method", label: "Method & verify" },
  { n: "09", to: "/app/status", label: "Build status" },
];

export function Logo() {
  return (
    <Link to="/" className="logo" aria-label="Assay home">
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <rect width="32" height="32" rx="8" fill="#0052FF" />
        <path d="M6 22h20" stroke="#fff" strokeWidth="2" strokeLinecap="round" opacity=".9" />
        <path d="M10 22v-2.5M14 22v-2.5M18 22v-2.5M22 22v-2.5" stroke="#fff" strokeWidth="1.4" strokeLinecap="round" opacity=".55" />
        <path d="M16 7v13" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />
      </svg>
      Assay
    </Link>
  );
}

export function TopNav() {
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => { setOpen(false); }, [loc.pathname]);
  return (
    <header className="topnav">
      <div className="wrap">
        <Logo />
        <nav className={`navlinks ${open ? "open" : ""}`} aria-label="Primary">
          <NavLink to="/" end>Overview</NavLink>
          <NavLink to="/app" end>Board</NavLink>
          <NavLink to="/app/agent">Agent</NavLink>
          <NavLink to="/app/method">Method</NavLink>
          <NavLink to="/app/status">Status</NavLink>
          <a href="https://github.com/ace-coderr/assay" target="_blank" rel="noreferrer">GitHub</a>
        </nav>
        <button className="btn small burger" aria-expanded={open} aria-label="Toggle menu" onClick={() => setOpen((o) => !o)}>
          {open ? "Close" : "Menu"}
        </button>
      </div>
    </header>
  );
}

export function Footer() {
  const { data, error } = useApi<Status>("/api/status", 30_000);
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((x) => x + 1), 15_000);
    return () => clearInterval(id);
  }, []);
  const age = data?.updatedAt ? (Date.now() - Date.parse(data.updatedAt)) / 1000 : null;
  const ok = !!data && !!data.sources?.tokensApi.ok && !!data.sources?.rpc.ok;
  return (
    <footer className="footer">
      <div className="wrap">
        <div className="footer-live" aria-live="polite">
          <span><span className={`live-dot ${ok ? "" : "off"}`} /> <b>{error ? "status unavailable" : data ? (ok ? "live" : "source degraded") : "checking"}</b></span>
          <span>network: <b>Base mainnet (8453)</b></span>
          <span>data: <b>Coinbase Tokenized Stocks API + Base RPC</b></span>
          <span>last reading: <b>{age == null ? "n/a" : `${fmtAge(age)} ago`}</b></span>
          {data?.block && <span>block: <b>{Number(data.block).toLocaleString("en-US")}</b></span>}
        </div>
        <div className="footer-grid">
          <div>
            <Logo />
            <p className="small" style={{ marginTop: 12 }}>
              A read-only integrity layer for tokenized stocks on Base. Built on Base.
            </p>
            <p className="small">{DISCLAIMER_TEXT}</p>
          </div>
          <div>
            <h4>Product</h4>
            <ul>
              <li><Link to="/app">Board</Link></li>
              <li><Link to="/app/liquidity">Liquidity probe</Link></li>
              <li><Link to="/app/agent">Agent (MCP)</Link></li>
              <li><Link to="/app/method">Method &amp; verify</Link></li>
            </ul>
          </div>
          <div>
            <h4>Open</h4>
            <ul>
              <li><a href="https://github.com/ace-coderr/assay" target="_blank" rel="noreferrer">Source (MIT)</a></li>
              <li><a href="/api/feed.xml">RSS feed</a></li>
              <li><Link to="/app/status">Build status</Link></li>
            </ul>
          </div>
        </div>
        <div className="builtby">
          <span>Built by</span>
          <a className="ace-pill" href="https://x.com/_ace_won" target="_blank" rel="noreferrer">ace</a>
        </div>
      </div>
    </footer>
  );
}

export function AppShell() {
  const [sheet, setSheet] = useState(false);
  const loc = useLocation();
  useEffect(() => { setSheet(false); }, [loc.pathname]);
  const current = MODULES.slice().reverse().find((m) => loc.pathname === m.to || loc.pathname.startsWith(m.to + "/"))?.label ?? "Modules";
  const links = MODULES.map((m) => (
    <NavLink key={m.to} to={m.to} end={m.end}>
      <span className="n">{m.n}</span>
      {m.label}
    </NavLink>
  ));
  return (
    <div className="wrap app">
      <nav className="rail" aria-label="Modules">
        <div className="rail-h">Index</div>
        {links}
      </nav>
      <div id="content" style={{ minWidth: 0 }}>
        <Outlet />
      </div>
      <button className="btn sheet-btn" onClick={() => setSheet(true)} aria-haspopup="dialog">
        Modules · {current}
      </button>
      {sheet && (
        <>
          <div className="sheet-back" onClick={() => setSheet(false)} />
          <div className="sheet" role="dialog" aria-label="Modules" aria-modal="true">
            <div className="grab" />
            {links}
          </div>
        </>
      )}
    </div>
  );
}

export function PageShell() {
  const loc = useLocation();
  useEffect(() => { window.scrollTo({ top: 0 }); }, [loc.pathname]);
  return (
    <>
      <a className="skip" href="#main">Skip to content</a>
      <TopNav />
      <main id="main">
        <Outlet />
      </main>
      <Footer />
    </>
  );
}
