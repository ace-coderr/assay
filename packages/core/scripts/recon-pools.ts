import { createPublicClient, http, parseAbi, zeroAddress } from "viem";
import { base } from "viem/chains";
import fs from "node:fs";
const client = createPublicClient({ chain: base, transport: http(process.env.BASE_RPC_URL ?? "https://mainnet.base.org") });
const list = JSON.parse(fs.readFileSync("fixtures/tokenized-stocks.list.json", "utf8")).tokens as any[];
const feeds: Record<string, string> = { AAPLc:"0x787f13dEa48Db0897CbCDD985de77809D837F988",AMZNc:"0x06A8E4b3aBB3B7543d8396FB2B763d22820cB295",GOOGLc:"0x5bF49E0ffA937CE2FfF033c739aD7C634c4D34F2",METAc:"0x6526aE6797A76123638b863AeE4dD27Ba4E4b27D",MSFTc:"0xeB10A6c9aa7E537aEd766C08c35Dae35B321b18c",MSTRc:"0xB3cE282CD188b35DA0E38D8Bc7d58e33173D202a",NVDAc:"0x04689a41629776563E6822F76f2e57D148d28513",SNDKc:"0x388b0dC46C0Fb05A74BeE0994fa5b02c6Fcca2eA",SPCXc:"0x6A634B235903C4ad6376892180d6fF8612e3Fa68",TSLAc:"0xFaf869185383a24F8cb00e27BdA6b63B9905DCb4" };
const fabi = parseAbi(["function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)","function decimals() view returns (uint8)","function description() view returns (string)"]);
for (const [s, a] of Object.entries(feeds)) {
  const t = list.find((x) => x.symbol === s);
  try {
    const r: any = await client.readContract({ address: a as any, abi: fabi, functionName: "latestRoundData" });
    const d = await client.readContract({ address: a as any, abi: fabi, functionName: "description" });
    console.log(s, d, "feed", Number(r[1]) / 1e8, new Date(Number(r[3]) * 1000).toISOString(), "api nav", t.nav_price, t.nav_price_updated_at);
  } catch (e: any) { console.log(s, "ERR", (e.shortMessage ?? e.message).slice(0, 100)); }
}
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", WETH = "0x4200000000000000000000000000000000000006";
const v3 = parseAbi(["function getPool(address,address,uint24) view returns (address)"]);
const v2 = parseAbi(["function getPool(address,address,bool) view returns (address)"]);
const cl = parseAbi(["function getPool(address,address,int24) view returns (address)"]);
const nav = list.filter((x) => x.nav_price);
for (const t of nav) {
  const found: string[] = [];
  for (const q of [USDC, WETH]) {
    for (const fee of [100, 500, 3000, 10000]) {
      const p: any = await client.readContract({ address: "0x33128a8fC17869897dcE68Ed026d694621f6FDfD", abi: v3, functionName: "getPool", args: [t.contract_address, q, fee] }).catch(() => zeroAddress);
      if (p !== zeroAddress) found.push(`uniV3 ${q === USDC ? "USDC" : "WETH"} fee${fee} ${p}`);
    }
    for (const st of [true, false]) {
      const p: any = await client.readContract({ address: "0x420DD381b31aEf6683db6B902084cB0FFECe40Da", abi: v2, functionName: "getPool", args: [t.contract_address, q, st] }).catch(() => zeroAddress);
      if (p !== zeroAddress) found.push(`aeroV2 ${q === USDC ? "USDC" : "WETH"} stable=${st} ${p}`);
    }
    for (const ts of [1, 50, 100, 200, 2000]) {
      const p: any = await client.readContract({ address: "0x5e7BB104d84c7CB9B682AaC2F3d509f5F406809A", abi: cl, functionName: "getPool", args: [t.contract_address, q, ts] }).catch(() => zeroAddress);
      if (p !== zeroAddress) found.push(`aeroCL ${q === USDC ? "USDC" : "WETH"} ts${ts} ${p}`);
    }
  }
  console.log(t.symbol, found.length ? found : "no pools in uniV3/aeroV2/aeroCL");
}
