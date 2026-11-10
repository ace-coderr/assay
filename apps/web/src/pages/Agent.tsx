import { CopyBlock, Disclaimer } from "../components/bits";
import { REPO_URL } from "../lib/api";

const TOOLS: [string, string, string][] = [
  ["assay_token", "{ symbol }", "Latest reading for one token: DEX price vs reference, multiplier, state, reasons, pool used."],
  ["assay_board", "{}", "Every tracked token's latest reading and how many tokens cannot be assayed."],
  ["list_corporate_actions", "{ symbol? }", "Onchain announcements, scheduled multiplier updates, and multiplier changes detected."],
  ["probe_liquidity", "{ symbol, usd, side, live? }", "Read-only estimate of what a size would cost in the deepest qualifying pool. Re-reads the pool on-chain by default."],
  ["check_before_trade", "{ symbol, usd?, side, live? }", "A verdict only: ok, caution, avoid or unknown, with reasons. Never executes or prepares a trade."],
];

// Captured with packages/mcp/scripts/capture-example.mjs against the real data and a live Base RPC read.
const EXAMPLE = `request:  check_before_trade { "symbol": "AAPLc", "usd": 2000, "side": "buy" }

response: {
  "verdict": "ok",
  "reasons": [
    "within 100 bps of reference (12 bps)",
    "a $2000 buy costs about 3 bps in the deepest pool"
  ],
  "readOnly": true,
  "source": "live",
  "symbol": "AAPLc",
  "quote": { "side": "buy", "sizeUsd": 2000, "slippageBps": 2.8, "lowerBound": false, "feeBps": 2.67, "ticksCrossed": 0 },
  "disclaimer": "Information only. Not financial advice. Not endorsed by Base or token issuers."
}`;

export default function Agent() {
  return (
    <>
      <div className="page-h">
        <div>
          <h1>Agent (MCP)</h1>
          <p>An MCP server so an AI agent can ask Assay whether a tokenized stock&rsquo;s price can be trusted. All five tools are read-only. There is no tool that trades, signs or holds funds.</p>
        </div>
      </div>

      <div className="banner info" role="note">
        <b>There is no hosted MCP endpoint.</b> Assay is hosted on GitHub Pages, which serves static files only. The MCP server runs <b>on your own machine</b> over stdio, started by your agent. It needs Node.js 20 or newer and nothing else: no account, no API key, no cost.
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <b>Set up (Claude Code)</b>
        <p className="muted" style={{ fontSize: 14 }}>One command. It downloads the server from GitHub on first use.</p>
        <CopyBlock text={`claude mcp add assay -- npx -y github:ace-coderr/assay`} />
      </div>

      <div className="grid-2" style={{ marginTop: 16 }}>
        <div className="card">
          <b>Other MCP clients (JSON config)</b>
          <CopyBlock text={JSON.stringify({ mcpServers: { assay: { command: "npx", args: ["-y", "github:ace-coderr/assay"] } } }, null, 2)} />
        </div>
        <div className="card">
          <b>Run it from a clone</b>
          <CopyBlock text={`git clone ${REPO_URL}.git\ncd assay\nnode packages/mcp/dist/assay-mcp.mjs`} />
          <p className="notice">The built server is committed at <code>packages/mcp/dist/assay-mcp.mjs</code>. To rebuild it: <code>pnpm install &amp;&amp; pnpm --filter @assay/mcp build</code>.</p>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <b>Where the data comes from</b>
        <ul className="muted" style={{ fontSize: 14, margin: "8px 0 0", paddingLeft: 18 }}>
          <li>Readings, history and corporate actions are the same JSON this site reads, published every 10 minutes to the <code>data</code> branch of the repository.</li>
          <li><code>probe_liquidity</code> and <code>check_before_trade</code> also re-read the pool directly from a public Base RPC, so the price impact reflects the pool right now. Pass <code>live: false</code> to use the published reading only.</li>
          <li>If the published data is more than 45 minutes old, or an RPC is down, the tools say so and return <b>unknown</b> instead of a guess.</li>
          <li>No rate limiting is applied by Assay. The public RPCs have their own limits.</li>
        </ul>
      </div>

      <h2 style={{ fontSize: 22, margin: "28px 0 12px" }}>Tools</h2>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Tool</th><th>Input</th><th>Returns</th></tr></thead>
          <tbody>{TOOLS.map(([n, i, d]) => <tr key={n}><td><code>{n}</code></td><td><code>{i}</code></td><td className="muted">{d}</td></tr>)}</tbody>
        </table>
      </div>

      <h2 style={{ fontSize: 22, margin: "28px 0 12px" }}>Example</h2>
      <p className="muted" style={{ fontSize: 14 }}>
        A real exchange captured from the built server on 2026-11-10 at 23:27 UTC. Your agent sends the request as an MCP tool call; prices and bps will differ when you run it.
      </p>
      <CopyBlock text={EXAMPLE} label="Copy" />

      <p className="notice">
        What an agent should do with a verdict: <b>ok</b> means the price check passed and the size fits the pool; <b>caution</b> means slow down or reduce size; <b>avoid</b> means do not act on this price; <b>unknown</b> means Assay cannot say (no reference, no deep pool, or data that is too old).
      </p>
      <Disclaimer />
    </>
  );
}
