import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { createPublicClient, http, parseAbi, fallback } from "viem";
import { base } from "viem/chains";
import { v3Price, type PoolRead } from "@assay/core";
import { Disclaimer, ErrorBox } from "../components/bits";
import { fmtBps, fmtPrice, useApi, type Board, type Status } from "../lib/api";

const POOL_ABI = parseAbi([
  "function slot0() view returns (uint160 sqrtPriceX96,int24 tick,uint16,uint16,uint16,uint8,bool)",
  "function liquidity() view returns (uint128)",
]);

interface Repro { onchain: number; stored: number; diffBps: number; liquidity: string; block: string; rpc: string }

export default function Method() {
  const [sp] = useSearchParams();
  const board = useApi<Board>("/api/board");
  const status = useApi<Status>("/api/status");
  const ok = board.data?.readings.filter((r) => r.status === "ok") ?? [];
  const [symbol, setSymbol] = useState(sp.get("symbol") ?? "");
  const [res, setRes] = useState<Repro | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!symbol && ok[0]) setSymbol(ok[0].symbol); }, [ok.length, symbol]);
  const r = ok.find((x) => x.symbol === symbol);
  const pool = r?.poolUsed as (PoolRead & { sqrtPriceX96?: string }) | undefined;

  const run = async () => {
    if (!r || !pool || pool.venue !== "uniswap-v3") return;
    setBusy(true); setErr(null); setRes(null);
    try {
      const client = createPublicClient({ chain: base, transport: fallback([http("https://base-rpc.publicnode.com"), http("https://mainnet.base.org")]) });
      const [s0, liq, block] = await Promise.all([
        client.readContract({ address: pool.pool, abi: POOL_ABI, functionName: "slot0" }),
        client.readContract({ address: pool.pool, abi: POOL_ABI, functionName: "liquidity" }),
        client.getBlockNumber(),
      ]);
      const price = v3Price(s0[0], !!pool.tokenIsToken0, 8);
      setRes({ onchain: price, stored: pool.spotPrice, diffBps: ((price - pool.spotPrice) / pool.spotPrice) * 1e4, liquidity: liq.toString(), block: block.toString(), rpc: "public RPC from your browser" });
    } catch (e) { setErr(e instanceof Error ? e.message : "RPC error"); }
    finally { setBusy(false); }
  };

  const th = status.data?.thresholds;
  return (
    <>
      <div className="page-h">
        <div>
          <h1>Method &amp; verify</h1>
          <p>Exactly how a reading is computed, the thresholds used, and a way to reproduce any reading yourself from a public RPC.</p>
        </div>
      </div>

      <div className="card">
        <b>Reproduce a reading</b>
        <p className="muted" style={{ fontSize: 14 }}>
          Your browser reads the stored pool directly from Base (<code>slot0()</code>, <code>liquidity()</code>) and recomputes the price with the same function Assay uses. Pools move, so expect a small difference from the stored reading, not an exact match.
        </p>
        <div className="row">
          <label>Token
            <select value={symbol} onChange={(e) => { setSymbol(e.target.value); setRes(null); }}>{ok.map((x) => <option key={x.symbol}>{x.symbol}</option>)}</select>
          </label>
          <button className="btn primary" onClick={() => void run()} disabled={busy || !pool || pool.venue !== "uniswap-v3"}>{busy ? "Reading chain…" : "Recompute in my browser"}</button>
        </div>
        {pool && pool.venue !== "uniswap-v3" && <p className="muted" style={{ fontSize: 13 }}>This reading used an Aerodrome v2 pool; browser reproduction covers Uniswap v3 pools.</p>}
        {err && <p className="coral" role="alert" style={{ fontSize: 13 }}>RPC error: {err}</p>}
        {board.error && <ErrorBox error={board.error} onRetry={board.reload} />}
        {r && pool && (
          <dl className="kv" style={{ marginTop: 14 }}>
            <dt>Stored reading</dt><dd>${fmtPrice(pool.spotPrice, 4)} at block {r.block} · {r.readAt}</dd>
            <dt>Pool</dt><dd><a href={`https://basescan.org/address/${pool.pool}`} target="_blank" rel="noreferrer">{pool.pool}</a></dd>
            <dt>Reference</dt><dd>${fmtPrice(r.reference, 4)} (updated {r.referenceUpdatedAt})</dd>
            <dt>Deviation stored</dt><dd>{fmtBps(r.deviationBps)}</dd>
          </dl>
        )}
        {res && (
          <div className="banner info" style={{ marginTop: 14 }} aria-live="polite">
            Recomputed now: <b>${fmtPrice(res.onchain, 4)}</b> at block {Number(res.block).toLocaleString("en-US")} ({fmtBps(res.diffBps)} vs stored). In-range liquidity {res.liquidity}.
          </div>
        )}
      </div>

      <div className="grid-2" style={{ marginTop: 16 }}>
        <div className="card">
          <b>Formulas</b>
          <pre style={{ marginTop: 10 }}>{`price(USDC/token) from slot0:
  raw = (sqrtPriceX96 / 2^96)^2        // token1 per token0
  price = (token is token0 ? raw : 1/raw)
          * 10^(tokenDecimals - 6)

deviation_bps = (dex - reference) / reference * 10000
underlying    = reference / multiplier
reference is already total return:
  it is NOT multiplied by the multiplier again`}</pre>
        </div>
        <div className="card">
          <b>Thresholds</b>
          {th ? (
            <dl className="kv" style={{ marginTop: 10 }}>
              <dt>Drifting above</dt><dd>{th.driftBps} bps</dd>
              <dt>Broken above</dt><dd>{th.brokenBps} bps</dd>
              <dt>Reference max age</dt><dd>{(th.maxReferenceAgeSec / 3600).toFixed(0)} h (feed heartbeat 24 h + margin)</dd>
              <dt>Min pool depth</dt><dd>${th.minDepthUsd} USDC and non-zero in-range liquidity</dd>
              <dt>TWAP divergence</dt><dd>{th.twapDivergenceBps} bps over {th.twapWindowSec / 60} min</dd>
              <dt>Pool disagreement</dt><dd>{th.poolDisagreementBps} bps</dd>
            </dl>
          ) : status.error ? <p className="coral">Unavailable: {status.error}</p> : <p className="muted">Loading…</p>}
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <b>Manipulation and thin-liquidity guards</b>
        <ul style={{ color: "var(--muted)", fontSize: 14.5 }}>
          <li>A Uniswap v3 pool with zero in-range liquidity still reports a price. Live examples were far off (5000 vs ~643, 999.99 vs ~350, 3.4e40). Such pools are rejected, and the reason is shown.</li>
          <li>Pools holding under $1,000 of USDC are ignored.</li>
          <li>The deepest qualifying pool is used. If another qualifying pool disagrees by more than 300 bps, or spot differs from the 30 minute TWAP by more than 300 bps, the reading is Broken.</li>
          <li>Aerodrome v2 pools have no onchain TWAP read, so only depth and cross-pool agreement protect them.</li>
          <li>Probe estimates are lower bounds when a size leaves the pool's current liquidity range.</li>
        </ul>
        <p className="notice">Sources are documented in <a href="https://github.com/ace-coderr/assay/blob/main/docs/data-sources.md" target="_blank" rel="noreferrer">docs/data-sources.md</a>, with the real responses used as test fixtures.</p>
      </div>
      <Disclaimer />
    </>
  );
}
