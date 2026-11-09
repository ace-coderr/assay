import { createPublicClient, http, parseAbi } from "viem";
import { base } from "viem/chains";
import fs from "node:fs";
const rpcs = ["https://mainnet.base.org", "https://base-rpc.publicnode.com"];
const clients = rpcs.map((u) => createPublicClient({ chain: base, transport: http(u) }));
const list = JSON.parse(fs.readFileSync("fixtures/tokenized-stocks.list.json", "utf8")).tokens as any[];
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913".toLowerCase();
const pools = fs.readFileSync(process.env.TEMP + "/pools.txt", "utf8");
const abi = parseAbi(["function slot0() view returns (uint160,int24,uint16,uint16,uint16,uint8,bool)","function liquidity() view returns (uint128)","function token0() view returns (address)","function token1() view returns (address)","function balanceOf(address) view returns (uint256)"]);
let cur = "";
for (const line of pools.split("\n")) {
  const sm = line.match(/^(\w+c)\b/); if (sm) cur = sm[1]!;
  const m = line.match(/uniV3 USDC fee(\d+) (0x[0-9a-fA-F]{40})/); if (!m) continue;
  const t = list.find((x) => x.symbol === cur)!; const pool = m[2] as `0x${string}`;
  const row: any = { sym: cur, fee: m[1], pool };
  for (const [i, c] of clients.entries()) {
    const [s0, liq, t0] = await Promise.all([
      c.readContract({ address: pool, abi, functionName: "slot0" }) as Promise<any>,
      c.readContract({ address: pool, abi, functionName: "liquidity" }) as Promise<bigint>,
      c.readContract({ address: pool, abi, functionName: "token0" }) as Promise<string>,
    ]);
    const r = Number(s0[0]) / 2 ** 96; const raw = r * r; // token1/token0 raw
    const tokIs0 = t0.toLowerCase() === t.contract_address.toLowerCase();
    const price = tokIs0 ? raw * 1e8 / 1e6 : (1 / raw) * 1e8 / 1e6; // USDC per token
    const usdcBal = Number(await c.readContract({ address: USDC as any, abi, functionName: "balanceOf", args: [pool] })) / 1e6;
    row["rpc" + i] = { price: +price.toFixed(4), liq: String(liq), usdcDepth: usdcBal, block: String(await c.getBlockNumber()) };
  }
  row.ref = t.nav_price; row.mult = t.multiplier;
  console.log(JSON.stringify(row));
}
