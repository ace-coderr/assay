import { Link } from "react-router-dom";
import { Strip } from "../components/Strip";
import { Disclaimer, Reveal, SectionPill, StateBadge } from "../components/bits";
import { fmtAge, fmtBps, fmtPrice, useApi, type Board } from "../lib/api";

function ReadingConsole() {
  const { data, error, loading } = useApi<Board>("/api/board", 30_000);
  const ok = data?.readings.filter((r) => r.status === "ok") ?? [];
  const r = ok.find((x) => x.symbol === "AAPLc") ?? ok[0];
  const raw = r
    ? JSON.stringify(
        {
          token: r.symbol,
          dex_price: Number(r.dexPrice!.toFixed(4)),
          reference: r.reference,
          multiplier: r.multiplier,
          deviation_bps: Number(r.deviationBps!.toFixed(1)),
          pool: r.poolUsed?.pool,
          pool_usdc_depth: Math.round(r.poolUsed?.usdcDepth ?? 0),
          block: r.block,
          state: r.state,
        },
        null,
        2,
      )
    : error
      ? `// source unavailable\n// ${error}`
      : "// reading…";
  return (
    <div className="console" aria-label="Live reading console">
      <div className="console-head">
        <span className="dots" aria-hidden="true"><i /><i /><i /></span>
        <span>assay read --live</span>
        {error ? <span className="badge unavailable">OFFLINE</span> : <span className="badge live"><span className="live-dot" /> READ LIVE</span>}
      </div>
      <div className="console-body">
        {loading && <div className="skeleton" style={{ height: 120 }} />}
        {!loading && (
          <>
            <div className="console-title">
              <b>{r ? r.symbol : "no reading"}</b>
              {r && <StateBadge r={r} />}
              {r && <span className="muted mono" style={{ fontSize: 12 }}>read {fmtAge((Date.now() - Date.parse(r.readAt)) / 1000)} ago</span>}
            </div>
            <Strip deviationBps={r?.deviationBps} state={r?.state} label={r?.symbol} />
            {r && (
              <div className="mono" style={{ fontSize: 13, color: "var(--muted)" }}>
                DEX ${fmtPrice(r.dexPrice)} · reference ${fmtPrice(r.reference)} · {fmtBps(r.deviationBps)}
              </div>
            )}
            <pre aria-label="Raw output">{raw}</pre>
          </>
        )}
      </div>
    </div>
  );
}

const COMPARE: [string, string, string][] = [
  ["Source", "One pool's spot price, taken as given", "DEX price checked against the issuer's reference value (Chainlink total-return feed)"],
  ["Multiplier", "Ignored. A split or dividend looks like a crash", "Read from the token. A multiplier change between readings marks the reading Broken"],
  ["Thin pools", "A pool with no liquidity still returns a price", "Pools with zero in-range liquidity or dust depth are rejected, with the reason shown"],
  ["Manipulation", "A flash trade moves the number", "Spot is compared with a 30 minute TWAP and with other deep pools"],
  ["When it fails", "Silently wrong", "An explicit unavailable state. Never a made-up number"],
];

const STEPS = [
  ["Read the pool", "Find every USDC pool for the token on Uniswap v3 and Aerodrome v2, read price, in-range liquidity, USDC depth and the 30 minute TWAP.", "slot0() · liquidity() · observe()"],
  ["Read the reference", "Take the issuer's reference value and its update time. It matches the Chainlink feed onchain and holds its last value off-hours.", "nav_price · nav_price_updated_at"],
  ["Adjust the multiplier", "The reference is already total-return, so it is compared directly. The multiplier is read to derive the share price and to catch corporate actions.", "multiplier() · nav_price / multiplier"],
  ["Compare", "Deviation in basis points between the deepest qualifying pool and the reference, cross-checked against TWAP and other pools.", "deviation_bps = (dex - ref) / ref"],
  ["Flag", "Assign Fresh, Stale, Drifting or Broken with plain-language reasons, and store the reading with its block number so anyone can reproduce it.", "state + reasons + block"],
];

const STATES: [string, string, string, string][] = [
  ["Fresh", "Within 100 bps of the reference, reference under 26 hours old, deep pool.", "Price can be used as a sanity check. Still size within pool depth.", "fresh"],
  ["Stale", "Reference older than 26 hours: feed frozen (weekend, holiday, pause).", "Do not treat the comparison as reliable. Wait or use another source.", "stale"],
  ["Drifting", "DEX is 100 to 500 bps from the reference.", "Slow down. Re-check, reduce size, or wait for convergence.", "drifting"],
  ["Broken", "Over 500 bps, spot disagrees with TWAP or pools, or the multiplier changed.", "Do not act on this price. Escalate to a human.", "broken"],
];

export default function Landing() {
  return (
    <>
      <div className="wrap">
        <section className="hero" aria-labelledby="h1">
          <div>
            <SectionPill n="00" label="Integrity layer for tokenized stocks" />
            <h1 id="h1">
              Don't trust a price.<br />
              <em>Assay it.</em>
            </h1>
            <p className="lead">
              Assay compares each tokenized stock's onchain DEX price with its reference value, accounts for multiplier changes, and flags drift or thin liquidity. Read-only, on Base.
            </p>
            <div className="cta">
              <Link className="btn primary" to="/app">Open the board</Link>
              <Link className="btn" to="/app/agent">Connect an agent</Link>
            </div>
            <p className="hero-note">
              Assay holds no funds, executes no trades and has no swap or trade controls. Not financial advice. Not endorsed by Base or token issuers.
            </p>
          </div>
          <ReadingConsole />
        </section>

        <section className="section" aria-labelledby="s1">
          <Reveal>
            <SectionPill n="01" label="The difference" />
            <h2 id="s1">Trusting a price vs assaying it</h2>
            <p className="sub">A DEX quote is a claim. An assay checks the claim against something it cannot fake cheaply.</p>
          </Reveal>
          <Reveal delay={80}>
            <div className="compare">
              <section className="left" aria-label="Trusting a price">
                <h3 className="col-h">Trusting a price</h3>
                {COMPARE.map(([k, a]) => (
                  <div key={k} className="cell"><span className="k">{k}</span>{a}</div>
                ))}
              </section>
              <section aria-label="Assaying it">
                <h3 className="col-h assay">Assaying it</h3>
                {COMPARE.map(([k, , b]) => (
                  <div key={k} className="cell"><span className="k">{k}</span>{b}</div>
                ))}
              </section>
            </div>
          </Reveal>
        </section>

        <section className="section" aria-labelledby="s2">
          <Reveal>
            <SectionPill n="02" label="A reading" />
            <h2 id="s2">Five steps, every reading</h2>
            <p className="sub">Each reading is stored with its block number and the pool it used, so it can be reproduced from a public RPC.</p>
          </Reveal>
          <div className="timeline">
            {STEPS.map(([t, d, c], i) => (
              <Reveal key={t} delay={i * 70}>
                <div className="card tl-card hover">
                  <span className="dot">{i + 1}</span>
                  <h3>{t}</h3>
                  <p>{d}</p>
                  <code>{c}</code>
                </div>
              </Reveal>
            ))}
          </div>
        </section>

        <section className="section" aria-labelledby="s3">
          <Reveal>
            <SectionPill n="03" label="States" />
            <h2 id="s3">What an agent should do</h2>
            <p className="sub">Four states with fixed thresholds. Tokens with no reference value or no deep pool are shown as unavailable instead.</p>
          </Reveal>
          <div className="matrix">
            {STATES.map(([name, when, todo, cls], i) => (
              <Reveal key={name} delay={i * 70}>
                <div className="card hover" style={{ height: "100%" }}>
                  <span className={`badge ${cls}`}>{name.toUpperCase()}</span>
                  <h3>{name}</h3>
                  <p>{when}</p>
                  <div className="do"><b>Agent should</b>{todo}</div>
                </div>
              </Reveal>
            ))}
          </div>
        </section>

        <section className="section" aria-labelledby="s4">
          <Reveal>
            <SectionPill n="04" label="Honest status" />
            <h2 id="s4">What runs today, and what doesn't</h2>
          </Reveal>
          <Reveal delay={80}>
            <div className="status-list" style={{ marginTop: 22 }}>
              <div className="card">
                <b>Runs today</b>
                <ul>
                  {[
                    "Readings every 5 minutes on Netlify, stored with history",
                    "Reference values for 12 tokens, matched to the Chainlink feeds",
                    "Uniswap v3 and Aerodrome v2 USDC pools, with depth and TWAP guards",
                    "Public read-only API, RSS feed, signed webhooks",
                    "Remote MCP server with five read-only tools",
                    "Reproduce any reading from a public RPC in your browser",
                  ].map((t) => (<li key={t}><span className="tick yes" aria-hidden="true">✓</span>{t}</li>))}
                </ul>
              </div>
              <div className="card">
                <b>Does not run</b>
                <ul>
                  {[
                    "Anything that trades, swaps, signs or holds funds",
                    "The other 306 tokens: the API publishes no reference value for them, so they cannot be assayed",
                    "CRCLc and INTCc: a reference exists but no USDC pool was found",
                    "Uniswap v4 and concentrated Aerodrome pools",
                    "Multi-tick swap simulation: large sizes are reported as 'at least'",
                    "Mainnet attestations: Base Sepolia testnet only",
                  ].map((t) => (<li key={t}><span className="tick no" aria-hidden="true">×</span>{t}</li>))}
                </ul>
              </div>
            </div>
          </Reveal>
        </section>

        <section className="section" aria-labelledby="s5">
          <Reveal>
            <SectionPill n="05" label="Built on" />
            <h2 id="s5">Public infrastructure only</h2>
          </Reveal>
          <div className="built-on" style={{ marginTop: 22 }}>
            {[
              ["Base", "Tokens, pools and the attestation contract all live on Base. Built on Base."],
              ["Tokenized Stocks API", "Coinbase's public, keyless reference data: supplies, multipliers, reference values."],
              ["Chainlink feeds", "Total-return reference values, read onchain and matched to the API."],
              ["Uniswap v3 · Aerodrome", "Where the tokens actually trade. Read directly over a public RPC with viem."],
            ].map(([t, d], i) => (
              <Reveal key={t} delay={i * 60}>
                <div className="card hover" style={{ height: "100%" }}><h3>{t}</h3><p>{d}</p></div>
              </Reveal>
            ))}
          </div>
          <Disclaimer />
        </section>
      </div>
    </>
  );
}
