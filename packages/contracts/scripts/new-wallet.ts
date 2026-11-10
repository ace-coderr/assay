// Generates a throwaway Base Sepolia key into the repo-root .env (gitignored) and prints only the address.
import fs from "node:fs";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
const envPath = new URL("../../../.env", import.meta.url);
const cur = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
if (/^SEPOLIA_PRIVATE_KEY=0x/m.test(cur)) { console.log("A key already exists in .env, not overwriting."); process.exit(0); }
const k = generatePrivateKey();
fs.writeFileSync(envPath, cur.replace(/^SEPOLIA_PRIVATE_KEY=.*\n?/m, "") + `SEPOLIA_PRIVATE_KEY=${k}\n`);
console.log("Testnet deployer address:", privateKeyToAccount(k).address);
