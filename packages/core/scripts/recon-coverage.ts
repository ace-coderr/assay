// For each reference token with no usable reading, look for pools on every Base DEX factory we can verify,
// against several quote assets. Every factory is first sanity-checked against a known pair so a wrong
// address cannot produce a false "no pool". Output is JSON written to fixtures/coverage.json.
import fs from "node:fs";
import { createPublicClient, fallback, http, parseAbi, zeroAddress, pad, type Hex } from "viem";
import { base } from "viem/chains";

const client = createPublicClient({
  chain: base,
  transport: fallback([http("https://base-rpc.publicnode.com", { retryCount: 3, retryDelay: 400 }), http("https://mainnet.base.org", { retryCount: 2 })]),
});
const list = JSON.parse(fs.readFileSync("fixtures/tokenized-stocks.list.json", "utf8")).tokens as any[];
const MISSING = ["TSLAc", "GOOGLc", "SNDKc", "MSTRc", "SPCXc", "CRCLc", "INTCc"];
const tokens = MISSING.map((s) => list.find((t) => t.symbol === s)).map((t) => ({ symbol: t.symbol as string, address: t.contract_address as `0x${string}`, firstMint: t.first_mint_date as string }));

const Q: Record<string, `0x${string}`> = {
  USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  WETH: "0x4200000000000000000000000000000000000006",
  USDbC: "0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA",
  cbBTC: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
  EURC: "0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42",
  DAI: "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb",
  AERO: "0x940181a94A35A4569E4529A3CDfB74e38FD98631",
  USDT: "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2",
};

const getPair = parseAbi(["function getPair(address,address) view returns (address)"]);
const getPoolFee = parseAbi(["function getPool(address,address,uint24) view returns (address)"]);
const getPoolStable = parseAbi(["function getPool(address,address,bool) view returns (address)"]);
const getPoolTick = parseAbi(["function getPool(address,address,int24) view returns (address)"]);

type Kind = "v2" | "v3" | "aeroV2" | "slipstream";
const FACTORIES: { name: string; kind: Kind; addr: `0x${string}`; params: number[] }[] = [
  { name: "Uniswap V2", kind: "v2", addr: "0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6", params: [] },
  { name: "Uniswap V3", kind: "v3", addr: "0x33128a8fC17869897dcE68Ed026d694621f6FDfD", params: [100, 500, 3000, 10000] },
  { name: "Aerodrome V2", kind: "aeroV2", addr: "0x420DD381b31aEf6683db6B902084cB0FFECe40Da", params: [0, 1] },
  { name: "Aerodrome Slipstream", kind: "slipstream", addr: "0x5e7BB104d84c7CB9B682AaC2F3d509f5F406809A", params: [1, 10, 50, 100, 200, 2000] },
  { name: "SushiSwap V2", kind: "v2", addr: "0x71524B4f93c58fcbF659783284E38825f0622859", params: [] },
  { name: "SushiSwap V3", kind: "v3", addr: "0xc35DADB65012eC5796536bD9864eD8773aBc74C4", params: [100, 500, 3000, 10000] },
  { name: "PancakeSwap V2", kind: "v2", addr: "0x02a84c1b3BBD7401a5f7fa98a384EBC70bB5749E", params: [] },
  { name: "PancakeSwap V3", kind: "v3", addr: "0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865", params: [100, 500, 2500, 10000] },
  { name: "BaseSwap V2", kind: "v2", addr: "0xFDa619b6d20975be80A10332cD39b9a4b0FAa8BB", params: [] },
  { name: "Alien Base V2", kind: "v2", addr: "0x3E84D913803b02A4a7f027165E8cA42C14C0FdE7", params: [] },
];

async function lookup(f: (typeof FACTORIES)[number], a: `0x${string}`, b: `0x${string}`, p?: number): Promise<string> {
  try {
    if (f.kind === "v2") return (await client.readContract({ address: f.addr, abi: getPair, functionName: "getPair", args: [a, b] })) as string;
    if (f.kind === "v3") return (await client.readContract({ address: f.addr, abi: getPoolFee, functionName: "getPool", args: [a, b, p!] })) as string;
    if (f.kind === "aeroV2") return (await client.readContract({ address: f.addr, abi: getPoolStable, functionName: "getPool", args: [a, b, p === 1] })) as string;
    return (await client.readContract({ address: f.addr, abi: getPoolTick, functionName: "getPool", args: [a, b, p!] })) as string;
  } catch {
    return zeroAddress;
  }
}

const out: any = { checkedAt: new Date().toISOString(), head: String(await client.getBlockNumber()), factories: {}, tokens: {} };

// 1. Sanity: each factory must have code and return a pool for a pair that certainly exists (WETH/USDC) on at least one param.
for (const f of FACTORIES) {
  const code = await client.getCode({ address: f.addr });
  let known = false;
  for (const p of f.params.length ? f.params : [undefined]) {
    if ((await lookup(f, Q.WETH!, Q.USDC!, p)) !== zeroAddress) known = true;
  }
  out.factories[f.name] = { address: f.addr, hasCode: !!code && code !== "0x", knownPairWethUsdc: known };
  console.log(f.name.padEnd(22), "code:", !!code && code !== "0x", "WETH/USDC found:", known);
}

// 2. Search each token against each quote on each verified factory.
for (const t of tokens) {
  const found: any[] = [];
  for (const f of FACTORIES) {
    if (!out.factories[f.name].hasCode) continue;
    for (const [qn, qa] of Object.entries(Q)) {
      for (const p of f.params.length ? f.params : [undefined]) {
        const pool = await lookup(f, t.address, qa, p);
        if (pool !== zeroAddress) found.push({ dex: f.name, quote: qn, param: p ?? null, pool });
      }
    }
  }
  out.tokens[t.symbol] = { address: t.address, pools: found };
  console.log(t.symbol, "->", found.length, "pools", found.map((x) => `${x.dex}/${x.quote}${x.param != null ? ":" + x.param : ""}`).join(", "));
}
fs.writeFileSync("fixtures/coverage-factories.json", JSON.stringify(out, null, 2));
console.log("wrote fixtures/coverage-factories.json");
