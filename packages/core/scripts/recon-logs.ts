import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import fs from "node:fs";

const list = JSON.parse(fs.readFileSync("fixtures/tokenized-stocks.list.json", "utf8")).tokens as any[];
const TOPICS = [
  "0xccebf8218a62875909564adef86a6f4df81503cb617221e793357d62f8e813f7",
  "0x2205df4534432b2f60654a3fdb48737ffdaf3e9edb1a498bd985bc026b15b055",
];
const addrs = list.filter((t) => t.multiplier !== 1 || t.nav_price).map((t) => t.contract_address);
const url = "https://base-rpc.publicnode.com";
const c = createPublicClient({ chain: base, transport: http(url) });
const head = await c.getBlockNumber();
for (const [n, span] of [[10, 49_999n], [10, 50_000n], [10, 20_000n], [7, 49_999n]] as const) {
  const from = head - 600_000n;
  try {
    const logs = await c.request({
      method: "eth_getLogs",
      params: [{ address: addrs.slice(0, n), topics: [TOPICS], fromBlock: ("0x" + from.toString(16)) as any, toBlock: ("0x" + (from + span).toString(16)) as any }],
    } as any);
    console.log("addrs", n, "span", String(span), "->", (logs as any[]).length, "logs");
  } catch (e: any) {
    console.log("addrs", n, "span", String(span), "ERR", (e.details ?? e.shortMessage ?? e.message).slice(0, 160));
  }
}
