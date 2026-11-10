// Compiles contracts with the solc binary on PATH (0.8.24) and writes out/AssayAttestations.json
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const file = path.join(root, "src", "AssayAttestations.sol");
const input = {
  language: "Solidity",
  sources: { "AssayAttestations.sol": { content: readFileSync(file, "utf8") } },
  settings: { optimizer: { enabled: true, runs: 200 }, outputSelection: { "*": { "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object"] } } },
};
const raw = execFileSync("solc", ["--standard-json"], { input: JSON.stringify(input), maxBuffer: 1 << 26 }).toString();
const res = JSON.parse(raw);
const errs = (res.errors ?? []).filter((e) => e.severity === "error");
if (errs.length) { console.error(errs.map((e) => e.formattedMessage).join("\n")); process.exit(1); }
const c = res.contracts["AssayAttestations.sol"].AssayAttestations;
mkdirSync(path.join(root, "out"), { recursive: true });
writeFileSync(path.join(root, "out", "AssayAttestations.json"), JSON.stringify({ abi: c.abi, bytecode: "0x" + c.evm.bytecode.object }, null, 2));
console.log("compiled, bytecode bytes:", c.evm.bytecode.object.length / 2);
