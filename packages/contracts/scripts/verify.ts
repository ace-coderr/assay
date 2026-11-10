// Read-only check of the deployed contract: events decode, and tx calldata carries the ERC-8021 suffix.
import fs from "node:fs";
import { parseAbiItem, formatUnits } from "viem";
import { Attribution } from "ox/erc8021";
import { publicClient } from "./common.js";

const dep = JSON.parse(fs.readFileSync(new URL("../deployments/base-sepolia.json", import.meta.url), "utf8"));
const logs = await publicClient.getLogs({
  address: dep.address,
  event: parseAbiItem("event Attested(address indexed token, address indexed attester, uint256 price, uint256 referencePrice, uint64 timestamp, uint8 state)"),
  fromBlock: BigInt(dep.block),
});
console.log("events:", logs.length);
for (const l of logs) {
  const tx = await publicClient.getTransaction({ hash: l.transactionHash });
  const attr = Attribution.fromData(tx.input);
  console.log(l.args.token, formatUnits(l.args.price!, 8), formatUnits(l.args.referencePrice!, 8), "state", l.args.state, "| builder codes:", JSON.stringify(attr?.codes));
}
