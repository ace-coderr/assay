import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { decodeFunctionData, encodeFunctionData, toFunctionSelector, toEventSelector } from "viem";

const art = JSON.parse(fs.readFileSync(new URL("../out/AssayAttestations.json", import.meta.url), "utf8"));
const src = fs.readFileSync(new URL("../src/AssayAttestations.sol", import.meta.url), "utf8");

describe("AssayAttestations", () => {
  it("compiles and exposes one function and one event", () => {
    expect(art.bytecode.length).toBeGreaterThan(100);
    const fns = art.abi.filter((x: any) => x.type === "function");
    expect(fns.map((f: any) => f.name)).toEqual(["attest"]);
    expect(art.abi.filter((x: any) => x.type === "event").map((e: any) => e.name)).toEqual(["Attested"]);
  });
  it("event carries token, price, reference, timestamp, state", () => {
    const ev = art.abi.find((x: any) => x.type === "event");
    expect(ev.inputs.map((i: any) => i.name)).toEqual(["token", "attester", "price", "referencePrice", "timestamp", "state"]);
    expect(toEventSelector("Attested(address,address,uint256,uint256,uint64,uint8)")).toMatch(/^0x/);
  });
  it("cannot hold funds or move tokens: not payable, no transfer/call/delegatecall/selfdestruct", () => {
    expect(art.abi.some((x: any) => x.stateMutability === "payable" || x.type === "receive" || x.type === "fallback")).toBe(false);
    expect(src).not.toMatch(/\.call\(|delegatecall|selfdestruct|transfer\(|transferFrom/);
  });
  it("attest calldata round-trips", () => {
    const data = encodeFunctionData({ abi: art.abi, functionName: "attest", args: ["0x97F35d1E92795327614BE000cd18cba1Be2c1931", 35100000000n, 35048720000n, 1_700_000_000n, 0] });
    expect(data.startsWith(toFunctionSelector("attest(address,uint256,uint256,uint64,uint8)"))).toBe(true);
    expect(decodeFunctionData({ abi: art.abi, data }).functionName).toBe("attest");
  });
});
