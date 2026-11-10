import { buildReading, discoverPools, makeClient, readPools, type Reading, type TokenRef } from "@assay/core";

/**
 * Re-read a token's pools on-chain right now, from the browser, over the public Base RPCs (they allow CORS), and
 * rebuild the reading with the same engine the pipeline uses. The reference value is the published one.
 * Read-only: only eth_call / eth_blockNumber are sent.
 */
export async function liveReading(r: Reading): Promise<Reading> {
  if (r.reference == null || !r.referenceUpdatedAt) throw new Error("no reference value to compare against");
  const client = makeClient();
  const token: TokenRef = {
    address: r.address,
    symbol: r.symbol,
    name: r.symbol,
    decimals: 8,
    multiplier: r.multiplier,
    navPrice: r.reference,
    navUpdatedAt: r.referenceUpdatedAt,
  };
  const found = await discoverPools(client, [token]);
  const { pools, block } = await readPools(client, token, found.get(token.address) ?? []);
  return buildReading({ token, pools, now: new Date(), block: String(block) });
}
