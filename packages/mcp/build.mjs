// Bundles the stdio server into ONE self-contained file (dependencies inlined) that is committed to the repo,
// so `npx github:ace-coderr/assay` needs no install or build step on the user's machine.
import { build } from "esbuild";
import { chmodSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, "dist", "assay-mcp.mjs");
mkdirSync(path.dirname(out), { recursive: true });
await build({
  entryPoints: [path.join(here, "src", "cli.ts")],
  outfile: out,
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  minify: false,
  legalComments: "none",
  banner: { js: "#!/usr/bin/env node\nimport { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
});
chmodSync(out, 0o755);
console.log("built", out);
