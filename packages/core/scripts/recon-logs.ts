import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import fs from "node:fs";

const list = JSON.parse(fs.readFileSync("fixtures/tokenized-stocks.list.json", "utf8")).tokens as any[];
const TOPICS = [
  "0xccebf8218a62875909564adef86a6f4df81503cb617221e793357d62f8e813f7", // Announcement
  "0x2205df4534432b2f60654a3fd2fb48737ffdaf3e9edb1a498bd985bc026b15b055".replace("fd2fb48737", "fdb48737"), // placeholder fixed below
];
TOPICS[1] = "0x2205df4534432b2f60654a3fdb48737ffdaf3e9edb1a498bd985bc026b15b055";
const addrs = list.filter((t) => t.multiplier !== 1 || t.nav_price).map((t) => t.contract_address);
console.log("watching", addrs.length, "tokens");
for (const url of ["https://mainnet.base.org", "https://base-rpc.publicnode.com"]) {
  const c = createPublicClient({ chain: base, transport: http(url) });
  const head = await c.getBlockNumber();
  for (const span of [9_000n, 100_000n, 1_000_000n, 4_000_000n]) {
    try {
      const logs = await c.request({
        method: "eth_getLogs",
        params: [{ address: addrs.slice(0, 10), topics: [TOPICS], fromBlock: ("0x" + (head - span).toString(16)) as any, toBlock: "latest" }],
      } as any);
      console.log(url, "span", String(span), "->", (logs as any[]).length, "logs");
    } catch (e: any) {
      console.log(url, "span", String(span), "ERR", (e.details ?? e.shortMessage ?? e.message).slice(0, 120));
    }
  }
}
