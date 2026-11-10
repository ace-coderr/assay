# Verification

What was checked, how, and what was **not** checked. Run on 2026-11-10 against Base mainnet with
`packages/core/scripts/verify-readings.ts`; raw output is in `fixtures/verification.json`.

Three live readings were cross-checked: AAPLc on Aerodrome Slipstream, CRCLc on Aerodrome Slipstream, and AAPLc on
Uniswap v3. Every check below is a direct, read-only contract call or `eth_call`.

## A. Same block, separate providers, direct pool calls

For each reading, the pool contract was read at the **exact block the reading was built from** on up to four
independent public RPC providers (publicnode, base.org, 1rpc, drpc), calling `slot0()`, `liquidity()`, `token0()`,
`fee()` and the pool's USDC `balanceOf`.

| Reading | Block | Providers that answered | Identical across providers | Equal to what Assay stored |
| --- | --- | --- | --- | --- |
| AAPLc, Aerodrome Slipstream `0xF5FCB9CD…946BA6` | 55,745,588 | publicnode, base.org, drpc | yes | yes |
| CRCLc, Aerodrome Slipstream `0x294666AD…4f1133` | 55,745,612 | publicnode, base.org, 1rpc, drpc | yes | yes |
| AAPLc, Uniswap v3 `0x97F35d1E…c1931` | 55,745,623 | publicnode, base.org, drpc | yes | yes |

Compared fields: `sqrtPriceX96`, `tick`, `liquidity`, USDC balance, `fee`. Where a provider did not answer
(1rpc returned an HTTP error once), it is simply not counted.

## B. Price recomputed with exact integer arithmetic

Assay computes price with floating-point math. Each price was also computed from `slot0().sqrtPriceX96` with
BigInt-only arithmetic (`sqrtPriceX96^2 / 2^192`, scaled by token decimals).

| Reading | Integer math | Assay float | Relative difference |
| --- | --- | --- | --- |
| AAPLc Slipstream | 348.615459 | 348.615460 | 2.4e-9 |
| CRCLc Slipstream | 64.326760 | 64.326761 | 1.3e-8 |
| AAPLc Uniswap v3 | 347.804475 | 347.804476 | 2.1e-9 |

Floating-point error is below one part in 10^7, far under the 100 bps state thresholds.

## C. Assay's swap simulation against the DEX's own quoter

For the Uniswap v3 pool, the same buy was run through Uniswap's deployed **QuoterV2**
(`0x3d4e44Eb…B76a`, `quoteExactInputSingle` via `eth_call` at the pinned block) and through Assay's tick-by-tick
simulation, which uses `tickBitmap()` and `ticks().liquidityNet` data read on-chain. Slippage is the effective price
against the pool's spot, fee included.

| Buy size | Quoter | Assay | Difference |
| --- | --- | --- | --- |
| $1,000 | 41.4266 bps | 41.4266 bps | 0.0001 bps |
| $5,000 | 89.0606 bps | 89.0606 bps | 0.00002 bps |
| $20,000 | 21,977 bps (pool runs out of liquidity) | 99.9 bps, labelled **AT LEAST** | not comparable |

At $20,000 the real trade exhausts the liquidity Assay read (within about 3% of the price), and the quoter shows
the true, enormous cost. Assay correctly refused to present a precise number and returned a lower bound with the
"at least" label. That is the intended behaviour, not a match.

## D. Reference value (earlier check)

For the 10 tokens with a documented Chainlink feed, `latestRoundData()` was read onchain and matched the Tokenized
Stocks API `nav_price` and `nav_price_updated_at` exactly (see `docs/data-sources.md`). CRCLc and INTCc have no
documented feed address, so their reference comes from the API alone.

## E. Third-party sanity check (not a verification)

DexScreener listed the CRCLc Slipstream pool at about $64.20 minutes before the onchain read of $64.33. It is shown
only as a rough sanity check of the price level. Assay does not use DexScreener prices; it was used for pool
discovery only, and every pool it suggested was re-checked onchain (see `docs/coverage.md`).

## Not done

- **No block-explorer check.** Basescan/Blockscout APIs need a key or block bots, so no explorer was queried. You can
  spot-check any pool by hand, for example
  `https://basescan.org/address/0x294666AD6a415E8C33Af801225c04079BB4f1133`, but that is a link, not a check.
- **No quoter check for Aerodrome Slipstream.** Its quoter address was not verified, so the swap-simulation check
  (C) covers Uniswap v3 only. The Slipstream pools were verified by checks A and B and use the same simulation code.
- **Not an audit.** These are spot checks of three readings on one day.

## Reproduce

```bash
pnpm --filter @assay/core exec tsx scripts/verify-readings.ts
node packages/core/scripts/summarize-verification.mjs
```
