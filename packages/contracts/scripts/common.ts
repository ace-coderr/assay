import { createPublicClient, createWalletClient, http, type Hex } from "viem";
import { baseSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { Attribution } from "ox/erc8021";

// Testnet only. There is deliberately no mainnet chain in this file.
export const chain = baseSepolia;
export const RPC = process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org";
export const publicClient = createPublicClient({ chain, transport: http(RPC) });

export function need(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing ${name}. Set it in .env (never commit it).`);
    process.exit(1);
  }
  return v;
}

export function wallet() {
  const key = need("SEPOLIA_PRIVATE_KEY") as Hex;
  const code = need("BUILDER_CODE");
  const account = privateKeyToAccount(key);
  // ERC-8021 Builder Code suffix appended to the calldata of every transaction this client sends.
  const dataSuffix = Attribution.toDataSuffix({ codes: [code] });
  const client = createWalletClient({ account, chain, transport: http(RPC), dataSuffix });
  return { account, client, dataSuffix };
}
