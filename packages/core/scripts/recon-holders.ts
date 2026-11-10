// DEX-agnostic check for tokens with no factory pools: scan every Transfer of the token since its first mint and
// list the contract counterparties (any AMM, vault or router must appear here to hold or move the token).
import fs from "node:fs";
import { createPublicClient, fallback, http, parseAbi, type Hex } from "viem";
import { base } from "viem/chains";

const client = createPublicClient({
  chain: base,
  transport: fallback([http("https://base-rpc.publicnode.com", { retryCount: 4, retryDelay: 600 }), http("https://mainnet.base.org", { retryCount: 2 })]),
});
const list = JSON.parse(fs.readFileSync("fixtures/tokenized-stocks.list.json", "utf8")).tokens as any[];
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const probe = parseAbi(["function token0() view returns (address)", "function token1() view returns (address)", "function factory() view returns (address)", "function getReserves() view returns (uint256,uint256,uint256)", "function slot0() view returns (uint160,int24)", "function name() view returns (string)"]);
const head = await client.getBlockNumber();
const out: any = {};
for (const sym of process.argv.slice(2)) {
  const t = list.find((x) => x.symbol === sym);
  const ageDays = (Date.now() - Date.parse(t.first_mint_date)) / 86400_000;
  const from0 = head - BigInt(Math.ceil((ageDays + 1) * 43200));
  const peers = new Map<string, { in: number; out: number }>();
  let transfers = 0;
  for (let from = from0; from <= head; from += 50_000n) {
    const to = from + 49_999n > head ? head : from + 49_999n;
    const logs = (await client.request({ method: "eth_getLogs", params: [{ address: t.contract_address, topics: [TRANSFER], fromBlock: `0x${from.toString(16)}`, toBlock: `0x${to.toString(16)}` }] } as never)) as any[];
    for (const l of logs) {
      transfers++;
      const a = "0x" + l.topics[1].slice(26), b = "0x" + l.topics[2].slice(26);
      for (const [x, k] of [[a, "out"], [b, "in"]] as const) {
        const e = peers.get(x.toLowerCase()) ?? { in: 0, out: 0 };
        e[k]++;
        peers.set(x.toLowerCase(), e);
      }
    }
  }
  const contracts: any[] = [];
  for (const [addr, c] of peers) {
    if (/^0x0+$/.test(addr)) continue;
    const code = await client.getCode({ address: addr as Hex });
    if (!code || code === "0x") continue;
    const kinds: string[] = [];
    for (const fn of ["token0", "token1", "factory", "getReserves", "slot0"] as const) {
      try { await client.readContract({ address: addr as Hex, abi: probe, functionName: fn } as never); kinds.push(fn); } catch { /* not present */ }
    }
    contracts.push({ addr, ...c, codeBytes: (code.length - 2) / 2, amm: kinds });
  }
  out[sym] = { scannedFrom: String(from0), scannedTo: String(head), transfers, uniquePeers: peers.size, contractPeers: contracts };
  console.log(sym, "transfers", transfers, "peers", peers.size, "contract peers", contracts.length, JSON.stringify(contracts.map((c) => [c.addr.slice(0, 10), c.in, c.out, c.amm.join("+") || "no-amm-interface"])));
}
fs.writeFileSync("fixtures/coverage-holders.json", JSON.stringify({ checkedAt: new Date().toISOString(), ...out }, null, 2));
