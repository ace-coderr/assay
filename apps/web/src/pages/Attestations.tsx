import { useEffect, useState } from "react";
import { createPublicClient, http, parseAbiItem, formatUnits } from "viem";
import { baseSepolia } from "viem/chains";
import { Disclaimer, Loading } from "../components/bits";

// The deployment file is written by packages/contracts/scripts/deploy.ts. Until a deployment exists, this is empty.
const files = import.meta.glob("../../../../packages/contracts/deployments/base-sepolia.json", { eager: true, import: "default" }) as Record<string, { address: `0x${string}`; deployTx: string; block: number }>;
const deployment = Object.values(files)[0];

const STATES = ["Fresh", "Stale", "Drifting", "Broken"];
const EVENT = parseAbiItem("event Attested(address indexed token, address indexed attester, uint256 price, uint256 referencePrice, uint64 timestamp, uint8 state)");

interface Row { token: string; attester: string; price: number; ref: number; ts: number; state: string; tx: string; block: bigint }

export default function Attestations() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!deployment) return;
    // sepolia.base.org caps eth_getLogs at 200 blocks; publicnode allows 50,000, so scan in chunks of that size.
    const client = createPublicClient({ chain: baseSepolia, transport: http("https://base-sepolia-rpc.publicnode.com") });
    (async () => {
      try {
        const head = await client.getBlockNumber();
        const logs = [];
        for (let from = BigInt(deployment.block); from <= head && logs.length < 500; from += 50_000n) {
          const to = from + 49_999n > head ? head : from + 49_999n;
          logs.push(...(await client.getLogs({ address: deployment.address, event: EVENT, fromBlock: from, toBlock: to })));
        }
        setRows(logs.reverse().map((l) => ({
          token: l.args.token!, attester: l.args.attester!, price: Number(formatUnits(l.args.price!, 8)), ref: Number(formatUnits(l.args.referencePrice!, 8)),
          ts: Number(l.args.timestamp), state: STATES[l.args.state!] ?? "?", tx: l.transactionHash, block: l.blockNumber,
        })));
      } catch (e) { setError(e instanceof Error ? e.message : "RPC error"); }
    })();
  }, []);

  return (
    <>
      <div className="page-h">
        <div>
          <h1>Attestations</h1>
          <p>Readings can be written onchain as an event: token, DEX price, reference, timestamp and state. This is a public log on <b>Base Sepolia (testnet)</b>. It proves who submitted which values and when, not that the values are right.</p>
        </div>
        <span className="badge">BASE SEPOLIA · TESTNET</span>
      </div>

      {!deployment ? (
        <div className="card" role="status">
          <b>Not deployed yet.</b>
          <p className="muted" style={{ margin: "6px 0 0" }}>
            The contract is written, compiled and tested, but it has not been deployed to Base Sepolia, so there are no attestations to show. This page will list them as soon as it is. Nothing is attested on Base mainnet.
          </p>
        </div>
      ) : (
        <>
          <div className="card" style={{ marginBottom: 16 }}>
            <dl className="kv">
              <dt>Contract</dt><dd><a href={`https://sepolia.basescan.org/address/${deployment.address}`} target="_blank" rel="noreferrer">{deployment.address}</a></dd>
              <dt>Deploy tx</dt><dd><a href={`https://sepolia.basescan.org/tx/${deployment.deployTx}`} target="_blank" rel="noreferrer">{deployment.deployTx}</a></dd>
              <dt>Event</dt><dd>Attested(token, attester, price, referencePrice, timestamp, state) · prices 8 decimals</dd>
            </dl>
          </div>
          {error && <div className="banner" role="alert">Base Sepolia RPC unavailable: {error}</div>}
          {!rows && !error && <Loading />}
          {rows && rows.length === 0 && <div className="card">No attestations submitted yet.</div>}
          {rows && rows.length > 0 && (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Token</th><th>State</th><th className="num">DEX</th><th className="num">Reference</th><th>Time (UTC)</th><th>Tx</th></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.tx}>
                      <td className="mono"><a href={`https://basescan.org/address/${r.token}`} target="_blank" rel="noreferrer">{r.token.slice(0, 8)}…{r.token.slice(-4)}</a></td>
                      <td><span className={`badge ${r.state.toLowerCase()}`}>{r.state.toUpperCase()}</span></td>
                      <td className="num">${r.price.toFixed(2)}</td><td className="num">${r.ref.toFixed(2)}</td>
                      <td className="mono">{new Date(r.ts * 1000).toISOString().replace("T", " ").slice(0, 19)}</td>
                      <td><a className="mono" href={`https://sepolia.basescan.org/tx/${r.tx}`} target="_blank" rel="noreferrer" aria-label={`View transaction ${r.tx} on Base Sepolia explorer`}>{r.tx.slice(0, 10)}…{r.tx.slice(-6)}</a></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      <p className="notice">The contract stores nothing, holds no funds, accepts no ETH and moves no tokens. Transactions carry an ERC-8021 Builder Code suffix for attribution.</p>
      <Disclaimer />
    </>
  );
}
