// Pre-bundles each Netlify function into one self-contained ESM file so the
// monorepo workspace imports (@assay/core) resolve without relying on the platform bundler.
import { build } from "esbuild";
import { readdirSync, mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(here, "netlify", "functions");
const out = path.join(here, "dist", "functions");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const entries = readdirSync(src).filter((f) => f.endsWith(".ts")).map((f) => path.join(src, f));
await build({
  entryPoints: entries,
  outdir: out,
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  sourcemap: false,
  logLevel: "info",
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
});
