# Data sources

Status: **documented from the Base docs; live responses NOT yet verified.**
The Tokenized Stocks API host did not resolve from the dev machine on the first
attempt, so no endpoint below has been checked against a real response yet.

## Tokenized Stocks API (Coinbase, read-only)

- Base URL: `https://api.coinbase.com/v1/tokenized-stocks`
- Key: none required (per docs). Rate limits: not documented.
- `GET /` paginated list (`page_size` default 100, max 500, `next_page_token`).
  Per token: address, symbol, name, decimals, ISIN, `multiplier`, and optionally
  `total_supply`, `nav_price`, `nav_price_updated_at`, `paused_features`, icon,
  `first_mint_date`. Zero/empty fields are omitted, so missing data must be
  treated as "unavailable", never as a price.
- `GET /chains` protocol contracts. `GET /total-supply/{addr}` normalized supply.
- `GET /corporate-actions/{id}` announced/applied action (by UUID).
- `nav_price` is a Chainlink total-return reference, not a bid/ask. Feeds hold
  the last value off-hours and freeze during corporate actions, so check
  `nav_price_updated_at`.

## Onchain (Base mainnet, chain id 8453)

- Tokens are B20 native precompiles (no bytecode on explorers). Read
  `multiplier()` / `uiMultiplier()` (WAD, 1e18), `decimals()`, `totalSupply()`.
- Chainlink feeds (8 decimals, `latestRoundData()`) are listed in the Base docs
  page "List Tokenized Stocks" for AAPL, AMZN, GOOGL, META, MSFT, MSTR, NVDA,
  SNDK, SPCX, TSLA.
- Onchain oracle registry: `0x3f3E8cf41cdd3b1D118c16471aB0113DfDDd5CaD`.
- Token price = underlying price x multiplier (feeds are total return).

## Still to verify (blocking)

1. Live API responses and field names.
2. DEX pools per token on Base and their on-chain price reads via viem.
3. Cross-check of results against a block explorer.
