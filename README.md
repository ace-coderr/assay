# Assay

A read-only integrity layer for tokenized stocks on Base.

Assay compares each token's onchain DEX price with its reference value, accounts for supply/multiplier changes
(splits, dividends), and flags drift or thin liquidity. It holds no funds, executes no trades, and has no swap or
trade controls anywhere.

**Live site: https://ace-coderr.github.io/assay/**

> Not financial advice. Assay is not endorsed by Base or by any token issuer. Built on Base.

## Architecture (all free, all on GitHub)

```
 GitHub Actions (cron, every 10 min)            GitHub Pages
 ┌──────────────────────────────┐              ┌───────────────────────────┐
 │ apps/pipeline                │              │ apps/web (static React)   │
 │  Coinbase Tokenized Stocks   │  JSON        │  reads the JSON           │
 │  API + Base RPC  ──► engine  ├─► `data` ───►│  probe + attestations read │
 │  (packages/core)             │   branch     │  Base RPC from the browser │
 └──────────────────────────────┘ (1 commit)   └───────────────────────────┘
                                      │
                                      └──► packages/mcp: a local stdio MCP server agents run themselves
```

| Part | Where it runs | Notes |
| --- | --- | --- |
| Readings pipeline | GitHub Actions, `.github/workflows/readings.yml` | Every 10 minutes (best-effort: GitHub can run it late). Publishes JSON to the orphan `data` branch as one force-pushed commit; rolling history is carried forward by reading the previous data first. Needs no secrets. |
| Website | GitHub Pages, `.github/workflows/pages.yml` | Static React app at `/assay/`, hash routing so deep links work. Reads the JSON from `raw.githubusercontent.com` and talks to the public Base RPCs directly for the liquidity probe and the attestation list. |
| MCP server | Your machine (stdio) | No hosted endpoint exists. See below. |
| Attestation contract | Base Sepolia (testnet) | Signing is local-only. No private key is in GitHub Actions or any secret. |

Why this shape and what changed from the earlier version: [`docs/hosting.md`](docs/hosting.md).

## What it does

For every token that has a published reference value, the pipeline reads the deepest qualifying USDC pool on Uniswap v3,
Aerodrome v2 and Aerodrome Slipstream over a public RPC, compares it with the reference, and assigns a state:

| State | Meaning |
| --- | --- |
| Fresh | within 100 bps of the reference, reference under 26 h old, deep pool |
| Stale | reference frozen (older than 26 h: weekend, holiday, pause) |
| Drifting | 100 to 500 bps from the reference |
| Broken | over 500 bps, spot disagrees with TWAP / other pools, or the multiplier changed |

Tokens with no reference value, or no pool that passes the guards, are shown as **unavailable** ("No pool on Base yet" /
"Pools too thin" / "No reference value"). Assay never substitutes a guessed number. Every reading shows its real age.

Details: [`docs/coverage.md`](docs/coverage.md) (which pools exist per token and how they were searched),
[`docs/verification.md`](docs/verification.md) (what was cross-checked and what was not),
[`docs/data-sources.md`](docs/data-sources.md) (what each source really returns).

## MCP server (local)

There is no hosted MCP endpoint. Run the server on your own machine; it needs Node.js 20+ and nothing else.

```bash
claude mcp add assay -- npx -y github:ace-coderr/assay
```

Other clients:

```json
{ "mcpServers": { "assay": { "command": "npx", "args": ["-y", "github:ace-coderr/assay"] } } }
```

Tools (all read-only): `assay_token`, `assay_board`, `list_corporate_actions`, `probe_liquidity`,
`check_before_trade` (verdict only, never executes). The built server is committed at
`packages/mcp/dist/assay-mcp.mjs`; rebuild it with `pnpm --filter @assay/mcp build`.

## Layout

| Path | Purpose |
| --- | --- |
| `packages/core` | Reading engine (pure TypeScript), on-chain readers (viem), shared read-side logic |
| `packages/mcp` | Local stdio MCP server |
| `packages/contracts` | Attestation contract (Base Sepolia only) and local scripts |
| `apps/pipeline` | The pipeline GitHub Actions runs |
| `apps/web` | Vite + React static site |
| `fixtures` | Real responses captured from live calls, used by the tests |
| `docs` | Hosting, coverage, verification and data-source notes |

## Develop

Requires Node 20+ and pnpm 9.

```bash
pnpm install
pnpm test               # core, pipeline, mcp, contracts (contracts needs solc on PATH)
pnpm dev:web            # the site, reading the live published data
pnpm pipeline           # one pipeline run into ./out (needs access to api.coinbase.com)
```

Copy `.env.example` to `.env` for optional settings. No secrets are committed.

### Attestations (testnet, local only)

`packages/contracts` emits an `Attested` event (token, price, reference, timestamp, state); it stores nothing and holds
no funds. The scripts target Base Sepolia only and append an ERC-8021 Builder Code suffix. Signing happens on your
machine with a key in your own `.env`; it is never added to GitHub Actions.

## Limits

See the Build status page: tokens without a reference value are not covered, Uniswap v4 is not read, trades beyond
about 3% of the price are reported as lower bounds, readings are best-effort every 10 minutes, and the contract is
testnet only.

## Licence

MIT
