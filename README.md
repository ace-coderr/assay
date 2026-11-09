# Assay

A read-only integrity layer for tokenized stocks on Base.

Assay compares each token's onchain DEX price with its reference value, accounts for
supply/multiplier changes (splits, dividends), and flags drift or thin liquidity.
It holds no funds, executes no trades, and has no swap or trade controls anywhere.

> Not financial advice. Assay is not endorsed by Base or by any token issuer.
> Built on Base.

## Layout

| Path | Purpose |
| --- | --- |
| `packages/core` | Shared reading engine (pure TypeScript) |
| `packages/mcp` | Remote MCP server tools |
| `packages/contracts` | Attestation contract (Base Sepolia only) |
| `apps/web` | Vite + React frontend |
| `apps/api` | Netlify Functions (scheduled readings + HTTP API) |
| `docs` | Data-source notes and method |

## Setup

```bash
pnpm install
pnpm test
pnpm dev:web
```

Requires Node 20+ and pnpm 9. Copy `.env.example` to `.env` for optional settings.
No secrets are committed.

## Status

Under construction. See the Build status page in the app for what runs today.

## Licence

MIT
