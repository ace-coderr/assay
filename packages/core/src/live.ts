import { buildReading } from "./assess.js";
import { discoverPools, makeClient, readPools } from "./chain.js";
import type { Reading, TokenRef } from "./types.js";

/**
 * Re-read a token's pools on-chain right now and rebuild the reading with the same engine the pipeline uses.
 * The reference value is the published one. Works in Node (MCP server) and in the browser (public RPCs allow CORS).
 * Read-only: only eth_call / eth_blockNumber are sent.
 */
export async function liveReading(r: Reading, rpcUrl?: string): Promise<Reading> {
  if (r.reference == null || !r.referenceUpdatedAt) throw new Error("no reference value to compare against");
  const client = makeClient(rpcUrl);
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
