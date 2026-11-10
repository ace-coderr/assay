import fs from "node:fs";
import { publicClient, wallet, chain } from "./common.js";

const art = JSON.parse(fs.readFileSync(new URL("../out/AssayAttestations.json", import.meta.url), "utf8"));
const dep = JSON.parse(fs.readFileSync(new URL("../deployments/base-sepolia.json", import.meta.url), "utf8"));
const DATA = process.env.ASSAY_DATA_URL ?? "https://raw.githubusercontent.com/ace-coderr/assay/data";
const STATE = { Fresh: 0, Stale: 1, Drifting: 2, Broken: 3 } as const;
const { client } = wallet();
if ((await publicClient.getChainId()) !== chain.id) throw new Error("RPC is not Base Sepolia (84532). Refusing.");

const board = await (await fetch(`${DATA}/board.json`)).json();
const only = process.argv[2]?.toLowerCase();
for (const r of board.readings) {
  if (r.status !== "ok") { console.log(r.symbol, "skipped:", r.unavailableReason); continue; }
  if (only && r.symbol.toLowerCase() !== only) continue;
  const hash = await client.writeContract({
    address: dep.address, abi: art.abi, functionName: "attest",
    args: [r.address, BigInt(Math.round(r.dexPrice * 1e8)), BigInt(Math.round(r.reference * 1e8)), BigInt(Math.floor(Date.parse(r.readAt) / 1000)), STATE[r.state as keyof typeof STATE]],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  console.log(r.symbol, r.state, hash);
}
