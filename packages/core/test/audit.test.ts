import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const root = path.resolve(__dirname, "../../..");
const SKIP = new Set(["node_modules", "dist", ".git", ".netlify", "out", "fixtures", "coverage"]);

function walk(dir: string, exts: string[], out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, exts, out);
    else if (exts.some((x) => e.name.endsWith(x))) out.push(p);
  }
  return out;
}
const read = (p: string) => fs.readFileSync(p, "utf8");
const rel = (p: string) => path.relative(root, p).replace(/\\/g, "/");

describe("audit: nothing can trade or sign", () => {
  // Product code only. Contract scripts (testnet attestation) are checked separately below.
  const product = [
    ...walk(path.join(root, "apps/web/src"), [".ts", ".tsx"]),
    ...walk(path.join(root, "apps/pipeline/lib"), [".ts"]),
    ...walk(path.join(root, "apps/pipeline/src"), [".ts"]),
    ...walk(path.join(root, "packages/core/src"), [".ts"]),
    ...walk(path.join(root, "packages/mcp/src"), [".ts"]),
  ];
  const FORBIDDEN = /sendTransaction|writeContract|signTransaction|signMessage|signTypedData|eth_sendTransaction|eth_sendRawTransaction|window\.ethereum|useWriteContract|useSendTransaction|createWalletClient|privateKeyToAccount|\.approve\(|swapExact|exactInput/;
  it("product code has no wallet, signing or swap calls", () => {
    const hits = product.filter((f) => FORBIDDEN.test(read(f))).map(rel);
    expect(hits).toEqual([]);
  });
  it("the web app renders no swap/trade/buy/sell button or link", () => {
    for (const f of walk(path.join(root, "apps/web/src"), [".tsx"])) {
      const src = read(f);
      const buttons = [...src.matchAll(/<(?:button|a|Link)\b[^>]*>([\s\S]*?)<\/(?:button|a|Link)>/g)].map((m) => m[1]!.replace(/<[^>]+>/g, " ").toLowerCase());
      for (const b of buttons) expect(b, rel(f)).not.toMatch(/\b(swap|trade now|buy now|sell now|execute|place order|connect wallet)\b/);
    }
  });
  it("the only transaction sender is the testnet attestation script, pinned to Base Sepolia", () => {
    const senders = walk(path.join(root, "packages/contracts/scripts"), [".ts"]).filter((f) => /writeContract|deployContract|createWalletClient/.test(read(f))).map(rel);
    expect(senders.sort()).toEqual(["packages/contracts/scripts/attest.ts", "packages/contracts/scripts/common.ts", "packages/contracts/scripts/deploy.ts"]);
    const common = read(path.join(root, "packages/contracts/scripts/common.ts"));
    expect(common).toMatch(/baseSepolia/);
    expect(common).not.toMatch(/chains["']\s*;?[\s\S]*\bbase\b\s*[,}]\s*from/);
    expect(common).not.toMatch(/import \{[^}]*\bbase\b[^}]*\} from "viem\/chains"/);
  });
});

describe("audit: static GitHub hosting", () => {
  const live = [
    ...walk(path.join(root, "apps/web/src"), [".ts", ".tsx"]),
    ...walk(path.join(root, "apps/pipeline"), [".ts"]),
    ...walk(path.join(root, "packages/mcp/src"), [".ts"]),
    ...walk(path.join(root, "packages/core/src"), [".ts"]),
    path.join(root, "README.md"),
    path.join(root, "apps/web/index.html"),
    ...walk(path.join(root, ".github"), [".yml"]),
  ];
  it("nothing in the running code or README depends on, or points to, Netlify", () => {
    const hits = live.filter((f) => /netlify/i.test(read(f))).map(rel);
    expect(hits).toEqual([]);
    expect(fs.existsSync(path.join(root, "netlify.toml"))).toBe(false);
  });
  it("the website never calls a server API: no /api, /mcp or webhook calls", () => {
    const hits = walk(path.join(root, "apps/web/src"), [".ts", ".tsx"]).filter((f) => /fetch\(\s*[`"']\/(api|mcp)|\/api\/webhooks/.test(read(f))).map(rel);
    expect(hits).toEqual([]);
  });
  it("the website only connects to hosts its Content-Security-Policy allows", () => {
    const html = read(path.join(root, "apps/web/index.html"));
    const csp = html.match(/Content-Security-Policy"\s+content="[^"]*?connect-src([^;"]*)/)![1]!;
    const allowed = [...csp.matchAll(/https:\/\/[a-z0-9.-]+/g)].map((m) => m[0]);
    const used = new Set<string>();
    for (const f of walk(path.join(root, "apps/web/src"), [".ts", ".tsx"])) {
      for (const m of read(f).matchAll(/["'`](https:\/\/[a-z0-9.-]+)/g)) {
        // links the user clicks are not connections; only look at hosts that appear next to fetch/http( calls
        const near = read(f).slice(Math.max(0, m.index! - 80), m.index!);
        if (/fetch\(|http\(|DATA_URL[^\n]*=|baseURL/.test(near) || /raw\.githubusercontent|api\.github|publicnode|mainnet\.base\.org/.test(m[1]!)) used.add(m[1]!);
      }
    }
    for (const h of used) {
      if (/basescan|github\.com$|x\.com|coinbase|base\.org\/assets/.test(h)) continue; // navigation links
      expect(allowed, h).toContain(h);
    }
  });
  it("workflows use no secrets and never mention a private key", () => {
    for (const f of walk(path.join(root, ".github"), [".yml"])) {
      const src = read(f);
      expect(src, rel(f)).not.toMatch(/secrets\.|PRIVATE_KEY|SEPOLIA|BUILDER_CODE|BEGIN [A-Z ]*PRIVATE/);
      expect(src, rel(f)).not.toMatch(/netlify|vercel|railway|cloudflare/i);
    }
  });
  it("the pipeline publishes only public data (no env dump, no keys)", () => {
    const src = walk(path.join(root, "apps/pipeline"), [".ts"]).map(read).join("\n");
    expect(src).not.toMatch(/process\.env\.(?!PREV_DIR|OUT_DIR|ASSAY_DATA_URL|BASE_RPC_URL)[A-Z_]+/);
  });
});

describe("audit: disclaimers", () => {
  it("every page and the footer carry the disclaimer", () => {
    for (const f of walk(path.join(root, "apps/web/src/pages"), [".tsx"])) {
      expect(read(f), rel(f)).toMatch(/Disclaimer|not financial advice|Not financial advice/i);
    }
    expect(read(path.join(root, "apps/web/src/components/Layout.tsx"))).toMatch(/DISCLAIMER_TEXT/);
    expect(read(path.join(root, "README.md"))).toMatch(/Not financial advice/);
  });
  it("does not use the Base logo or wordmark assets", () => {
    const files = walk(path.join(root, "apps/web"), [".svg", ".png", ".html", ".tsx", ".css"]);
    for (const f of files) expect(read(f), rel(f)).not.toMatch(/base-logo|basewordmark|base_wordmark/i);
  });
});

describe("audit: secrets and AI attribution stay out of the repo", () => {
  // Only files git tracks matter for leaks. Fall back to a walk that skips .env when git is unavailable.
  const gitFiles = (() => {
    try {
      return execSync("git ls-files", { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean).map((f) => path.join(root, f)).filter((f) => fs.existsSync(f));
    } catch {
      return null;
    }
  })();
  const tracked = (gitFiles ?? walk(root, [".ts", ".tsx", ".json", ".md", ".mjs", ".toml", ".sol", ".css", ".html", ".yaml", ".example"]))
    .filter((f) => !/pnpm-lock|\.(png|jpg|ico)$/.test(f));
  it(".env is not tracked by git", () => {
    expect(tracked.map(rel).filter((f) => f === ".env" || /^\.env\./.test(f) && f !== ".env.example")).toEqual([]);
  });
  it("no private keys or tokens in tracked source", () => {
    const bad = tracked.filter((f) => /SEPOLIA_PRIVATE_KEY=0x[0-9a-fA-F]{64}|gho_[A-Za-z0-9]{20,}|nfp_[A-Za-z0-9]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|\b0x[0-9a-fA-F]{64}\b(?=["'`]?\s*[,;)]?\s*\/\/\s*key)/.test(read(f))).map(rel);
    expect(bad).toEqual([]);
  });
  it(".env and .claude are git-ignored; no CLAUDE.md or .claude dir exists", () => {
    const gi = read(path.join(root, ".gitignore"));
    expect(gi).toMatch(/^\.env$/m);
    expect(gi).toMatch(/^\.claude\/$/m);
    expect(fs.existsSync(path.join(root, "CLAUDE.md"))).toBe(false);
    expect(fs.existsSync(path.join(root, ".claude"))).toBe(false);
  });
  it("no AI attribution lines in docs or source", () => {
    const bad = tracked.filter((f) => !/audit\.test\.ts$/.test(f) && /Co-Authored-By|Generated with|noreply@anthropic/i.test(read(f))).map(rel);
    expect(bad).toEqual([]);
  });
});
