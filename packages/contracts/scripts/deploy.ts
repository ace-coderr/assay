import fs from "node:fs";
import { publicClient, wallet, chain } from "./common.js";
import { formatEther } from "viem";

const art = JSON.parse(fs.readFileSync(new URL("../out/AssayAttestations.json", import.meta.url), "utf8"));
const { account, client } = wallet();
if ((await publicClient.getChainId()) !== chain.id) throw new Error("RPC is not Base Sepolia (84532). Refusing.");
const bal = await publicClient.getBalance({ address: account.address });
console.log("deployer", account.address, "balance", formatEther(bal), "ETH (Base Sepolia)");
if (bal === 0n) throw new Error("No testnet ETH. Fund the deployer from a Base Sepolia faucet.");
const hash = await client.deployContract({ abi: art.abi, bytecode: art.bytecode });
const rcpt = await publicClient.waitForTransactionReceipt({ hash });
const out = { network: "base-sepolia", chainId: chain.id, address: rcpt.contractAddress, deployTx: hash, block: Number(rcpt.blockNumber) };
fs.mkdirSync(new URL("../deployments", import.meta.url), { recursive: true });
fs.writeFileSync(new URL("../deployments/base-sepolia.json", import.meta.url), JSON.stringify(out, null, 2) + "\n");
console.log(out);
