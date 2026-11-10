// Uniswap v4 discovery: v4 has no factory getter, pools are announced by PoolManager Initialize events.
// Scans Initialize logs where either currency is one of the missing tokens, then reads each pool via StateView.
import fs from "node:fs";
import { createPublicClient, fallback, http, parseAbi, toEventSelector, pad, type Hex } from "viem";
import { base } from "viem/chains";

const POOL_MANAGER = "0x498581fF718922c3f8e6A244956aF099B2652b2b" as const;
const STATE_VIEW = "0xA3c0c9b65baD0b08107Aa264b0f3dB444b867A71" as const;
const SIG = "Initialize(bytes32,address,address,uint24,int24,address,uint160,int24)";
const TOPIC0 = toEventSelector(SIG);
const client = createPublicClient({
  chain: base,
  transport: fallback([http("https://base-rpc.publicnode.com", { retryCount: 4, retryDelay: 600 }), http("https://mainnet.base.org", { retryCount: 2 })]),
});
const list = JSON.parse(fs.readFileSync("fixtures/tokenized-stocks.list.json", "utf8")).tokens as any[];
const MISSING = ["TSLAc", "GOOGLc", "SNDKc", "MSTRc", "SPCXc", "CRCLc", "INTCc"];
const toks = MISSING.map((s) => list.find((t) => t.symbol === s));
const padded = toks.map((t) => pad(t.contract_address.toLowerCase() as Hex, { size: 32 }));
// Tokens were first minted 2026-08-12 (earliest) at roughly block 51.8M; start a little earlier to be safe.
const earliest = BigInt(process.env.FROM_BLOCK ?? "51500000");

const head = await client.getBlockNumber();
console.log("topic0", TOPIC0, "head", head, "from", earliest);
const found: any[] = [];
let calls = 0;
for (let from = earliest; from <= head; from += 50_000n) {
  const to = from + 49_999n > head ? head : from + 49_999n;
  for (const pos of [2, 3]) {
    // topics[1]=id, topics[2]=currency0, topics[3]=currency1: match any of the tokens in position `pos`
    const filt: (Hex | Hex[] | null)[] = [TOPIC0, null, null, null];
    filt[pos] = padded as Hex[];
    const logs = (await client.request({
      method: "eth_getLogs",
      params: [{ address: POOL_MANAGER, topics: filt, fromBlock: `0x${from.toString(16)}`, toBlock: `0x${to.toString(16)}` }],
    } as never)) as any[];
    calls++;
    // Strict local filter: some RPCs ignore OR-lists in topic positions, so never trust the server-side filter.
    const mine = new Set(toks.map((t) => t.contract_address.toLowerCase()));
    for (const l of logs.filter((x) => mine.has("0x" + x.topics[2].slice(26).toLowerCase()) || mine.has("0x" + x.topics[3].slice(26).toLowerCase()))) found.push({ id: l.topics[1], currency0: "0x" + l.topics[2].slice(26), currency1: "0x" + l.topics[3].slice(26), block: parseInt(l.blockNumber, 16), tx: l.transactionHash, data: l.data });
  }
  if (calls % 20 === 0) console.log("scanned to", String(to), "calls", calls, "found", found.length);
}
console.log("v4 Initialize events involving the 7 tokens:", found.length);
const stateAbi = parseAbi(["function getSlot0(bytes32) view returns (uint160 sqrtPriceX96,int24 tick,uint24 protocolFee,uint24 lpFee)", "function getLiquidity(bytes32) view returns (uint128)"]);
for (const f of found) {
  try {
    const s = (await client.readContract({ address: STATE_VIEW, abi: stateAbi, functionName: "getSlot0", args: [f.id] })) as any;
    const liq = (await client.readContract({ address: STATE_VIEW, abi: stateAbi, functionName: "getLiquidity", args: [f.id] })) as bigint;
    f.state = { sqrtPriceX96: String(s[0]), tick: Number(s[1]), lpFee: Number(s[3]), liquidity: String(liq) };
  } catch (e: any) {
    f.stateError = (e.shortMessage ?? e.message).slice(0, 100);
  }
  const sym = toks.find((t) => [f.currency0, f.currency1].some((c) => c.toLowerCase() === t.contract_address.toLowerCase()))?.symbol;
  f.token = sym;
  console.log(sym, f.id.slice(0, 10), f.currency0, f.currency1, JSON.stringify(f.state ?? f.stateError));
}
fs.writeFileSync("fixtures/coverage-v4.json", JSON.stringify({ checkedAt: new Date().toISOString(), poolManager: POOL_MANAGER, stateView: STATE_VIEW, topic0: TOPIC0, signature: SIG, scannedFrom: String(earliest), scannedTo: String(head), pools: found }, null, 2));
