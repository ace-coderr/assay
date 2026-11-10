// Probe an unknown pool factory: does getPool(USDC, token, fee) return the pool we found, who owns it, any name?
import { createPublicClient, fallback, http, parseAbi, type Hex } from "viem";
import { base } from "viem/chains";

const client = createPublicClient({ chain: base, transport: fallback([http("https://base-rpc.publicnode.com", { retryCount: 3, retryDelay: 400 }), http("https://mainnet.base.org", { retryCount: 2 })]) });
const F = (process.argv[2] ?? "0x9CB220581b91b0C83223012FE69688b92aD07a76") as Hex;
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as Hex;
const CRCL = "0xB20000000000000000000019f6E7C675b73C2e4D" as Hex;
const abi = parseAbi([
  "function getPool(address,address,uint24) view returns (address)", "function owner() view returns (address)", "function feeAmountTickSpacing(uint24) view returns (int24)",
  "function parameters() view returns (address,address,uint24,int24)", "function poolDeployer() view returns (address)", "function name() view returns (string)",
  "function implementation() view returns (address)", "function allPoolsLength() view returns (uint256)",
]);
const code = await client.getCode({ address: F });
console.log("factory", F, "code bytes", ((code?.length ?? 2) - 2) / 2);
for (const fn of ["owner", "poolDeployer", "name", "implementation", "allPoolsLength"] as const) {
  try { console.log(fn, await client.readContract({ address: F, abi, functionName: fn } as never)); } catch { console.log(fn, "-"); }
}
for (const fee of [100, 500, 3000, 10000]) {
  try { console.log("getPool fee", fee, await client.readContract({ address: F, abi, functionName: "getPool", args: [USDC, CRCL, fee] })); } catch { console.log("getPool fee", fee, "reverts"); }
  try { console.log("feeAmountTickSpacing", fee, await client.readContract({ address: F, abi, functionName: "feeAmountTickSpacing", args: [fee] })); } catch { /* none */ }
}
// Is it a proxy? read the EIP-1967 implementation slot.
const slot = await client.getStorageAt({ address: F, slot: "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc" });
console.log("eip1967 impl slot", slot);
// Which Uniswap v3 pool bytecode hash does it deploy? Compare runtime hash of pool with known Uniswap v3 pool.
const pool = "0x294666ad6a415e8c33af801225c04079bb4f1133" as Hex;
const uni = "0xd0b53D9277642d899DF5C87A3966A349A798F224" as Hex; // Uniswap v3 WETH/USDC 0.05% on Base
const { keccak256 } = await import("viem");
const pc = await client.getCode({ address: pool }), uc = await client.getCode({ address: uni });
console.log("pool code bytes", (pc!.length - 2) / 2, "hash", keccak256(pc!));
console.log("uniswap v3 pool code bytes", (uc!.length - 2) / 2, "hash", keccak256(uc!));
