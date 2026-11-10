// Verify the two Aerodrome concentrated-liquidity factories by on-chain getPool(token, USDC, tickSpacing).
import fs from "node:fs";
import { createPublicClient, fallback, http, parseAbi, zeroAddress, type Hex } from "viem";
import { base } from "viem/chains";

const client = createPublicClient({ chain: base, transport: fallback([http("https://base-rpc.publicnode.com", { retryCount: 3, retryDelay: 400 }), http("https://mainnet.base.org", { retryCount: 2 })]) });
const list = JSON.parse(fs.readFileSync("fixtures/tokenized-stocks.list.json", "utf8")).tokens as any[];
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as Hex;
const abi = parseAbi(["function getPool(address,address,int24) view returns (address)"]);
const FACTORIES = { "0x9CB2…(aero)": "0x9CB220581b91b0C83223012FE69688b92aD07a76", "0xf8f2…(aerodrome)": "0xf8f2eB4940CFE7d13603DDDD87f123820Fc061Ef", "0x5e7B…(older)": "0x5e7BB104d84c7CB9B682AaC2F3d509f5F406809A" } as Record<string, Hex>;
const SPACINGS = [1, 5, 10, 20, 50, 60, 100, 200, 2000];
const out: any = {};
for (const sym of ["TSLAc", "GOOGLc", "SNDKc", "MSTRc", "SPCXc", "CRCLc", "INTCc", "AAPLc", "NVDAc"]) {
  const t = list.find((x) => x.symbol === sym);
  out[sym] = {};
  for (const [name, f] of Object.entries(FACTORIES)) {
    const hits: any[] = [];
    for (const ts of SPACINGS) {
      try {
        const p = (await client.readContract({ address: f, abi, functionName: "getPool", args: [t.contract_address, USDC, ts] })) as string;
        if (p !== zeroAddress) hits.push({ tickSpacing: ts, pool: p });
      } catch { /* none */ }
    }
    out[sym][name] = hits;
    console.log(sym.padEnd(6), name.padEnd(20), hits.map((h) => `ts${h.tickSpacing}:${h.pool}`).join(" ") || "-");
  }
}
fs.writeFileSync("fixtures/coverage-slipstream.json", JSON.stringify({ checkedAt: new Date().toISOString(), factories: FACTORIES, tickSpacingsTried: SPACINGS, tokens: out }, null, 2));
