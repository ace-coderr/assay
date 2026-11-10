# Data sources

Everything here was observed in real responses on 2026-11-09 (Base mainnet,
block ~55,381,000). Nothing below is assumed. The Coinbase API was fetched from
Netlify's servers through the deployed `probe` function, because the dev
machine's network cannot reach `api.coinbase.com`. Onchain reads were made from
the dev machine over public RPCs.

Fixtures captured from these calls live in `/fixtures`.

## 1. Tokenized Stocks API (Coinbase, read-only)

Base URL `https://api.coinbase.com/v1/tokenized-stocks`. **No API key.** No rate
limit headers were returned (only `content-type`, `date`, and
`cache-control: public, max-age=300` on `/metadata`). Latency from Netlify:
36 to 200 ms. Limits are undocumented, so Assay caches and reads on a schedule.

| Endpoint | Observed response |
| --- | --- |
| `GET /?page_size=500` | `{ "tokens": [...] }`, **318 tokens**, no `next_page_token` at page size 500 |
| `GET /chains` | `{ chains: [{ chain_id: "8453", chain: "base", policy_registry_address: 0x8453…0002, token_supply_manager_address: 0xD1Ca4dAc…664C, token_factory_address: 0x4bA3E29E…534D }] }` |
| `GET /total-supply/{addr}` | bare JSON number, e.g. `1088.92197948` (AMDc) |
| `GET /metadata/{ticker}` | `{ contract_address, name, symbol, image, prospectus_url, description, … }` |

### Token record fields seen (counts over 318 tokens)

`contract_address` 318, `symbol` 318, `name` 318, `decimals` 318 (always 8),
`isin` 318, `multiplier` 318, `description` 318, `adgm_isin` 318,
`icon_url` 296, `total_supply` 71, `first_mint_date` 71,
`nav_price` **12**, `nav_price_updated_at` **12**.
`paused_features` was never present.

Consequences:

- Only **12 of 318** tokens carry a reference value: AAPLc, AMZNc, CRCLc, GOOGLc,
  INTCc, METAc, MSFTc, MSTRc, NVDAc, SNDKc, SPCXc, TSLAc. Assay can only assay these.
  Other tokens are listed as "no reference available", never given a number.
- Eight tokens have `multiplier` ≠ 1 (SANc, GOOGLc, ORCLc, NVDAc, METAc, PMc 1.5588,
  MRVLc, MUc). Multiplier is a JS number in the API; onchain it is WAD.
- Missing `nav_price` means unavailable, not zero.
- The list contains no corporate-action IDs.

## 2. Reference value (Chainlink, onchain)

The 10 feeds in the Base docs (AAPL, AMZN, GOOGL, META, MSFT, MSTR, NVDA, SNDK,
SPCX, TSLA) were read with `latestRoundData()` (8 decimals, `description()` like
"Coinbase AAPL"). **Value and `updatedAt` match the API's `nav_price` and
`nav_price_updated_at` exactly for all 10.** CRCLc and INTCc have a `nav_price`
in the API but no feed address is published in the docs; for those the API is the
only source.

Feeds hold the last value off-hours (e.g. AAPL last updated 15:27 UTC while others
updated later the same day), so staleness of the reference is a real, common case.

Per the Base docs the feed value is already `underlying × multiplier` (total
return). Assay therefore compares the DEX price to `nav_price` directly and does
**not** multiply by the multiplier again. The multiplier is used to (a) detect
corporate-action changes between readings and (b) derive underlying share price
`nav_price / multiplier`.

## 3. Onchain token reads (public RPC)

Tokens are B20 precompiles (`getCode` length 4, no bytecode). Reads that worked
with viem against `https://mainnet.base.org`: `symbol()`, `decimals()`,
`totalSupply()`, `multiplier()`, `uiMultiplier()` (WAD, 1e18).
For AMDc, NVDAc, GOOGLc, PMc, TSLAc, onchain `multiplier()` and `totalSupply()` were
identical to the API values.

Corporate actions: `Announcement` / `UIMultiplierUpdated` events on the token
address (topic0s in Base docs). `GET /corporate-actions/{uuid}` takes the UUID at
the end of the announcement `uri`. To be wired in step 4.

## 4. DEX pools on Base

Discovered with factory `getPool` calls (token vs USDC `0x8335…2913` and WETH).
The first recon found only **Uniswap V3** (`0x33128a8f…FDfD`) and **Aerodrome V2** volatile
(`0x420DD381…40Da`) pools, and wrongly concluded there were none on Aerodrome CL and none for CRCLc or INTCc: the
single Slipstream factory it queried (`0x5e7BB104…06809A`) holds no stock-token pools. **That was incomplete.** The
deep pools are on two other Aerodrome concentrated-liquidity factories (`0x9CB22058…D07a76`, `0xf8f2eB49…61Ef`),
and every one of the 12 reference tokens has a USDC pool there. See [coverage.md](coverage.md) for the full search
(10 factories, 8 quote assets, Uniswap v4 events, and a transfer scan) and the correction.

Price read: `slot0().sqrtPriceX96`, `liquidity()`, USDC balance of the pool.
Both `mainnet.base.org` and `base-rpc.publicnode.com` returned identical values on
every pool (see `fixtures/pool-reads.jsonl`).

Key observation, why depth guards are mandatory: pools with `liquidity() = 0`
or dust balances still report a price, and it can be wildly wrong
(METAc 0.01% pool: 5000.41 vs reference 643.72; AAPLc 1% pool: 3.4e40;
AAPLc 0.01% pool: 999.9998). Healthy pools were within ~0.05% to 0.8% of the
reference (e.g. AAPLc 0.3% pool $26.6k USDC depth: 351.39 vs 350.49). Some tokens have
only thin pools (SNDKc best pool ≈ $15.6 USDC).

## 5. Observed after deployment (2026-11-10)

- The token list grew from 318 to 328 records in one day; Assay paginates and re-reads it every run.
- Only 12 tokens still carry `nav_price`; the rest are not assayed.
- Corporate actions are discoverable onchain. The scheduled scan found a real **Cash Dividend** on
  NOKc: an `Announcement` (description "Cash Dividend", `uri` ending in a UUID that the
  `/corporate-actions/{uuid}` endpoint resolves) in the same transaction as a
  `UIMultiplierUpdated` event (multiplier 1 to 1.00196). Event signatures were checked against the
  documented topic0 hashes:
  `Announcement(address,string,string,string)` and `UIMultiplierUpdated(uint256,uint256,uint256)`.
- Public RPC limits that shaped the design: `mainnet.base.org` returns 429 after bursts;
  `base-rpc.publicnode.com` allows 10 addresses and 50,000 blocks per `eth_getLogs`. The scan is
  therefore incremental, chunked, and keeps a cursor.
- Total pool balance can overstate depth. Assay therefore estimates the cost to move each concentrated-liquidity
  pool's price 1% by reading every initialized tick within about 3% of the price (`tickBitmap()`, then
  `ticks().liquidityNet`) and simulating the push tick by tick, and ignores pools under $100.
  **Correction (2026-11-10):** an earlier version used only the single range between the two nearest initialized
  ticks, which badly understated the cost (for example CRCLc Slipstream $32 against $64,767 with real tick data;
  GOOGLc Uniswap pools $34 and $56 against $148 and $815). The multi-tick method replaced it; see docs/coverage.md.

## 6. Not verified

- **Block explorer cross-check:** Blockscout is behind a Cloudflare bot challenge
  and Etherscan's API does not serve Base on the free plan, so no explorer API
  could be used. Reads were instead cross-checked across two independent RPCs and
  against Chainlink. Spot-check any pool by hand on an explorer.
- Corporate-action endpoint (needs a real announcement UUID; see step 4).
- Uniswap V4 and other venues.

Live attestation contract (Base Sepolia): 0xa386fc75bcc1646569028623602e9b19e1eacee0
