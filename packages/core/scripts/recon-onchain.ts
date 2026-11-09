import { createPublicClient, http, parseAbi, formatUnits } from "viem";
import { base } from "viem/chains";
import fs from "node:fs";

const rpc = process.env.BASE_RPC_URL ?? "https://mainnet.base.org";
const client = createPublicClient({ chain: base, transport: http(rpc) });
const list = JSON.parse(fs.readFileSync("fixtures/tokenized-stocks.list.json", "utf8")).tokens as any[];
const abi = parseAbi([
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function multiplier() view returns (uint256)",
  "function uiMultiplier() view returns (uint256)",
]);
console.log("block", await client.getBlockNumber());
for (const sym of ["AMDc", "NVDAc", "GOOGLc", "PMc", "TSLAc"]) {
  const t = list.find((x) => x.symbol === sym);
  const addr = t.contract_address as `0x${string}`;
  const out: any = { sym, addr, api: { mult: t.multiplier, supply: t.total_supply } };
  for (const fn of ["symbol", "decimals", "totalSupply", "multiplier", "uiMultiplier"] as const) {
    try { out[fn] = String(await client.readContract({ address: addr, abi, functionName: fn })); }
    catch (e: any) { out[fn] = "ERR " + (e.shortMessage ?? e.message).slice(0, 80); }
  }
  try { out.code = (await client.getCode({ address: addr }))?.length ?? 0; } catch {}
  console.log(JSON.stringify(out));
}
