# Assay

A read-only integrity layer for tokenized stocks on Base.

Assay compares each token's onchain DEX price with its reference value, accounts for
supply/multiplier changes (splits, dividends), and flags drift or thin liquidity. It holds
no funds, executes no trades, and has no swap or trade controls anywhere.

Live: https://assay-onbase.netlify.app

> Not financial advice. Assay is not endorsed by Base or by any token issuer. Built on Base.

## What it does

For every token that has a published reference value, a scheduled function (every 5 minutes)
reads the deepest qualifying Uniswap v3 / Aerodrome v2 USDC pool over a public RPC, compares
it with the reference, and assigns a state:

| State | Meaning |
| --- | --- |
| Fresh | within 100 bps of the reference, reference under 26 h old, deep pool |
| Stale | reference frozen (older than 26 h: weekend, holiday, pause) |
| Drifting | 100 to 500 bps from the reference |
| Broken | over 500 bps, spot disagrees with TWAP / other pools, or the multiplier changed |

Tokens with no reference value, or no pool that passes the depth guard, are shown as
**unavailable**. Assay never substitutes a guessed number.

Method, thresholds and the guards against thin-pool manipulation are on the app's
"Method and verify" page. Data sources and what each endpoint really returns are in
[`docs/data-sources.md`](docs/data-sources.md).

## Layout

| Path | Purpose |
| --- | --- |
| `packages/core` | Reading engine (pure TypeScript) and onchain readers (viem) |
| `packages/mcp` | Remote MCP server definition (five read-only tools) |
| `packages/contracts` | Attestation contract (Base Sepolia only) |
| `apps/api` | Netlify Functions: scheduled readings, HTTP API, MCP endpoint |
| `apps/web` | Vite + React frontend |
| `fixtures` | Real responses captured from live calls, used by the tests |
| `docs` | Data-source notes |

## Setup

Requires Node 20+ and pnpm 9.

```bash
pnpm install
pnpm test          # core, api, mcp, contracts (needs solc on PATH for contracts)
pnpm dev:web       # frontend, proxies /api and /mcp to the deployed site
```

Copy `.env.example` to `.env` for optional settings. No secrets are committed.

### Deploy

The repo deploys to Netlify (`netlify.toml`). The build bundles the functions with esbuild
and builds the web app. Scheduled readings use Netlify scheduled functions and Netlify
Blobs, so nothing depends on a developer machine.

### API

`GET /api/status`, `/api/board`, `/api/token/:symbol`, `/api/history/:symbol`,
`/api/actions`, `/api/probe?symbol=&usd=&side=`, `/api/check?symbol=&usd=&side=`,
`/api/feed.xml`; `POST /api/webhooks`. There is no endpoint that trades.

### MCP

Remote streamable-HTTP server at `/mcp` with `assay_token`, `assay_board`,
`list_corporate_actions`, `probe_liquidity`, `check_before_trade` (verdict only).

```bash
claude mcp add --transport http assay https://assay-onbase.netlify.app/mcp
```

### Attestation contract (testnet)

`packages/contracts` emits an `Attested` event (token, price, reference, timestamp, state).
It stores nothing and holds no funds. Deploy and attest scripts target Base Sepolia only and
append an ERC-8021 Builder Code suffix to transactions.

## Limits

See the Build status page: tokens without a reference value are not covered, Uniswap v4 is
not read, large probe sizes are reported as lower bounds, and the contract is testnet only.

## Licence

MIT
