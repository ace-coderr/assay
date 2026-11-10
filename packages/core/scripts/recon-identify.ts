// Identify the AMM-like contracts found by recon-holders.ts: factory, tokens, fee, liquidity, balances.
import fs from "node:fs";
import { createPublicClient, fallback, http, parseAbi, formatUnits, type Hex } from "viem";
import { base } from "viem/chains";

const client = createPublicClient({ chain: base, transport: fallback([http("https://base-rpc.publicnode.com", { retryCount: 3, retryDelay: 400 }), http("https://mainnet.base.org", { retryCount: 2 })]) });
const hold = JSON.parse(fs.readFileSync("fixtures/coverage-holders.json", "utf8"));
const list = JSON.parse(fs.readFileSync("fixtures/tokenized-stocks.list.json", "utf8")).tokens as any[];
const abi = parseAbi([
  "function token0() view returns (address)", "function token1() view returns (address)", "function factory() view returns (address)",
  "function fee() view returns (uint24)", "function tickSpacing() view returns (int24)", "function liquidity() view returns (uint128)",
  "function slot0() view returns (uint160,int24)", "function getReserves() view returns (uint256,uint256,uint256)",
  "function symbol() view returns (string)", "function balanceOf(address) view returns (uint256)", "function decimals() view returns (uint8)",
]);
const call = async (address: Hex, fn: string, args: any[] = []) => { try { return await client.readContract({ address, abi, functionName: fn, args } as never); } catch { return null; } };
const report: any = {};
for (const sym of ["CRCLc", "INTCc"]) {
  const tok = list.find((t) => t.symbol === sym);
  report[sym] = [];
  for (const c of hold[sym].contractPeers.filter((x: any) => x.amm.length)) {
    const a = c.addr as Hex;
    const [t0, t1, factory, fee, ts, liq] = await Promise.all(["token0", "token1", "factory", "fee", "tickSpacing", "liquidity"].map((f) => call(a, f)));
    const sym0 = t0 ? await call(t0 as Hex, "symbol") : null, sym1 = t1 ? await call(t1 as Hex, "symbol") : null;
    const dec0 = t0 ? Number(await call(t0 as Hex, "decimals")) : 0, dec1 = t1 ? Number(await call(t1 as Hex, "decimals")) : 0;
    const b0 = t0 ? await call(t0 as Hex, "balanceOf", [a]) : null, b1 = t1 ? await call(t1 as Hex, "balanceOf", [a]) : null;
    const s0 = await call(a, "slot0");
    const rs = await call(a, "getReserves");
    const row = {
      pool: a, transfers: c.in + c.out, factory, fee, tickSpacing: ts == null ? null : Number(ts), liquidity: liq == null ? null : String(liq),
      token0: `${sym0}`, token1: `${sym1}`, bal0: b0 == null ? null : Number(formatUnits(b0 as bigint, dec0)), bal1: b1 == null ? null : Number(formatUnits(b1 as bigint, dec1)),
      slot0: s0 ? { sqrtPriceX96: String((s0 as any)[0]), tick: Number((s0 as any)[1]) } : null, reserves: rs ? (rs as bigint[]).slice(0, 2).map(String) : null,
    };
    report[sym].push(row);
    console.log(sym, JSON.stringify(row));
  }
}
fs.writeFileSync("fixtures/coverage-identified.json", JSON.stringify({ checkedAt: new Date().toISOString(), ...report }, null, 2));
