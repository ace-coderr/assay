# Coverage: which pools exist for each reference token

Checked 2026-11-10 on Base mainnet. There are 12 tokens with a published reference value. Before this work Assay
could assay 4 to 5 of them; with the changes described here all 12 have a usable pool. (As of writing, these changes
are committed and verified locally but not yet deployed: see the note at the end.)

## What went wrong first, and the correction

The first version found pools through a short, hard-coded list of factories (Uniswap v3, Aerodrome v2, and one
Aerodrome Slipstream factory `0x5e7BB104…06809A`). That Slipstream factory holds **no** stock-token pools. The deep
pools live on two other Aerodrome concentrated-liquidity factories, `0x9CB22058…D07a76` and `0xf8f2eB49…61Ef`, which
were missing. For seven tokens the old engine reported "unavailable" even though pools with $100k to $1.4M of
liquidity existed.

A second error compounded it. An early thin-liquidity guard estimated the cost to push a pool's price 1% using only
the single liquidity range between the two nearest initialized ticks. That badly **understated** cost for pools whose
liquidity is stacked over many ticks (for example the CRCLc pool: $32 estimated, $64,767 with real tick data), and
earlier notes that quoted figures such as "$34 and $56 for two GOOGLc pools" were wrong for that reason. The guard now
reads every initialized tick within about 3% of the price and simulates the push tick by tick (see
`docs/verification.md` for the check against Uniswap's own quoter).

## How pools were searched

1. **Factory lookups.** `getPool` / `getPair` on 10 factories, each first sanity-checked with a known WETH/USDC pair
   so a wrong address cannot look like "no pool": Uniswap V2, Uniswap V3, Aerodrome V2, Aerodrome Slipstream
   (three factories), SushiSwap V2, SushiSwap V3, PancakeSwap V2, PancakeSwap V3, BaseSwap V2, Alien Base V2.
   Quote assets tried: USDC, WETH, USDbC, cbBTC, EURC, DAI, AERO, USDT.
2. **Uniswap v4.** v4 has no factory getter, so `Initialize` events of the PoolManager
   (`0x498581fF…52b2b`) were scanned from block 51,500,000 (about 2026-08-04, before any of these tokens existed)
   to the chain head, matching either currency against the seven tokens, and each pool was read through StateView.
   2,210 `Initialize` events involved the seven tokens (many pair a stock token with some other token).
3. **Pool-agnostic transfer scan** for the two tokens with no factory hit (CRCLc, INTCc): every `Transfer` since first
   mint was read (3,755 and 4,594 transfers) and every contract counterparty was probed for AMM interfaces
   (`token0`, `token1`, `factory`, `slot0`, `getReserves`). This is what exposed the Slipstream pools my factory list
   was missing.
4. **Cross-reference.** DexScreener's pair list was used to cross-check completeness only. Its prices and liquidity are
   never used by Assay; every pool it suggested was re-read on-chain, and its liquidity numbers below are labelled.

Raw results are in `fixtures/coverage-*.json`; scripts are `packages/core/scripts/recon-*.ts`.

## Result per token (the seven that were unavailable)

"Cost to move 1%" is the on-chain tick-simulation figure (USD to push the price 1%); Assay requires at least $100.
Depths here were measured at slightly different minutes than the single-snapshot table further down, so a figure can
differ a little between the two.

| Token | DEXes and pool types checked | Result |
| --- | --- | --- |
| **TSLAc** | Uniswap V2, V3, V4; Aerodrome V2; Aerodrome Slipstream (3 factories); SushiSwap V2/V3; PancakeSwap V2/V3; BaseSwap; Alien Base | Used: Aerodrome Slipstream `0x7A33…F920`, $240k USDC, $100k to move 1%. Also Slipstream `0x4693…a7BB` ($23k, $408). Uniswap V3 USDC pool exists but has zero liquidity. Aerodrome V2 only an AERO pair with about $0. Uniswap V4: 9 USDC pairs, 6 with liquidity (not read). |
| **GOOGLc** | same | Used: Slipstream `0x16c7…47C3`, $662k, $110k+ to move 1%. Also Slipstream `0xB198…5542` ($12k, $702); Uniswap V3 0.3% ($1.4k, $148) and 1% ($5.8k, $815); PancakeSwap V3 0.05% ($1.35k); WETH and AERO pairs empty. V4: 10 USDC pairs, 3 with liquidity. |
| **SNDKc** | same | Used: Slipstream `0x2836…4E75`, $525k, $71k to move 1%. Also Slipstream `0x5A82…246E` ($16k, $331). Uniswap V3 USDC pools empty or $12; cbBTC pool $5. V4: 5 USDC pairs, 3 with liquidity. |
| **MSTRc** | same | Used: Slipstream `0x66DC…c153`, $240k, $94k to move 1%. Also Slipstream `0x8b27…10E2` ($23k, $914) and a cbBTC-quoted Slipstream pool (not read: non-USDC quote). Uniswap V3 pools empty; Aerodrome V2 AERO pair $21. V4: 11 USDC pairs, 6 with liquidity. |
| **SPCXc** | same | Used: Slipstream `0x880d…3cFE`, $483k, $114k+ to move 1%. Also Slipstream `0x0bf5…8c0E` ($13k, $315). Uniswap V3: empty, $12, and 1% ($4.0k, $92). Aerodrome V2 USDC pair $29. V4: 7 USDC pairs, 3 with liquidity. |
| **CRCLc** | same, all 8 quote assets, plus the transfer scan | Factory lookups on every DEX in the list found **nothing**. The transfer scan found the pool, confirmed by `getPool` on factory `0x9CB2…`: Slipstream `0x2946…1133`, $107k USDC, $65k to move 1%. A $5 V2-style pair also exists. V4: 3 USDC pairs, 1 with liquidity. |
| **INTCc** | same, plus the transfer scan | Same story. Slipstream `0x3D38…d4f3`, $112k USDC, $60k to move 1%. Tiny pairs ($17 and empty). V4: 2 USDC pairs, 1 with liquidity. |

Pools seen on DexScreener but not read on-chain by Assay: Equalizer (each under $510), Hydrex (about $22 to $2.5k),
flap.sh (bonding-style, about $2.5k to $8.9k), Nami and Solidly.com (about $7.7k to $11k, below Assay's limits).

## Current coverage: all 12 reference tokens

Generated from a local run of the new code against the real chain and API (block 55,747,063). All use USDC pools.

| Token | State | Pool used | Pool USDC | Cost to move 1% | Pools read / rejected | v4 USDC pools with liquidity |
| --- | --- | --- | --- | --- | --- | --- |
| CRCLc | Fresh | Aerodrome Slipstream `0x294666AD…1133` | $106,751 | $57,755 | 1 / 0 | 1 |
| TSLAc | Fresh | Aerodrome Slipstream `0x7A330003…F920` | $226,967 | $133,185 | 2 / 1 | 6 |
| GOOGLc | Fresh | Aerodrome Slipstream `0x16c70F04…47C3` | $653,224 | $127,409 | 4 / 0 | 3 |
| SNDKc | Fresh | Aerodrome Slipstream `0x2836e062…4E75` | $447,093 | $96,393 | 2 / 3 | 3 |
| MSTRc | Fresh | Aerodrome Slipstream `0x66DCd42E…c153` | $174,921 | $72,742 | 2 / 3 | 6 |
| INTCc | Fresh | Aerodrome Slipstream `0x3D384288…d4f3` | $111,295 | $64,940 | 1 / 0 | 1 |
| NVDAc | Fresh | Aerodrome Slipstream `0xF668e219…C8EC` | $485,558 | $56,675 | 2 / 8 | not scanned |
| SPCXc | Fresh | Aerodrome Slipstream `0x880dB7Dd…3cFE` | $480,085 | $122,183 | 2 / 4 | 3 |
| METAc | Fresh | Aerodrome Slipstream `0xd072410f…DC96` | $470,612 | $72,383 | 3 / 1 | not scanned |
| MSFTc | Fresh | Aerodrome Slipstream `0x2740C0fa…1ee7` | $238,001 | $131,153 | 3 / 0 | not scanned |
| AAPLc | Fresh | Aerodrome Slipstream `0xF5FCB9CD…6BA6` | $366,841 | $80,704 | 3 / 4 | not scanned |
| AMZNc | Fresh | Aerodrome Slipstream `0x532e0F46…DDf6` | $1,447,502 | $113,487 | 3 / 2 | not scanned |

Pool depth and cost change minute to minute; the live board is the source of truth. A token can still drop to
"unavailable" if its pools thin out.

## The "No pool on Base yet" state

If no pool is found at all, the Board and the token report show **"No pool on Base yet"** (reading code `no-pool`),
and if pools exist but none passes the guards they show "Pools too thin". Both are implemented and unit-tested. At
the time of writing **none of the 12 tokens triggers either state**: every one has a deep pool. Nothing is faked to
make that so.

## Not checked

- Balancer, Curve, Maverick, DODO, KyberSwap and other DEXes not in the list above; RFQ or market-maker venues and
  aggregator-only liquidity.
- Uniswap v4 pools: found and counted, but not read for prices. Their sizes (per DexScreener, about $10k to $47k for
  the largest USDC pool per token) are far below the Aerodrome pools, so they would not change a reading.
- Pools quoted in assets other than USDC (WETH, cbBTC, AERO). They exist for some tokens but are shallow or empty,
  apart from a cbBTC-quoted MSTRc Slipstream pool.
- The 326 tokens in the API that publish no reference value.

## Deployment note

The fixes in this document are committed and pushed, and were run end to end locally with `netlify dev` against the
real API and chain. At the time of writing they are **not on the live site**, because Netlify has skipped builds
("account credit usage exceeded"). The live site still runs the earlier engine. See the final report.
