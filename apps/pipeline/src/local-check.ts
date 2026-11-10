// Plumbing check only: runs the real refresh with the API response replaced by the captured fixture, real chain reads.
// Reference prices come from the fixture (old), so states are not meaningful; file layout and sizes are.
import fs from "node:fs";
import path from "node:path";
import { runRefresh } from "../lib/refresh.js";
import { buildPublicFiles } from "../lib/publish.js";
import { FileStore } from "../lib/store.js";

const fixture = fs.readFileSync(path.resolve(import.meta.dirname, "../../../fixtures/tokenized-stocks.list.json"), "utf8");
const fetchFn = (async (url: string | URL) => {
  const u = String(url);
  if (u.includes("/corporate-actions/")) return new Response("{}", { status: 404 });
  return new Response(JSON.stringify({ tokens: JSON.parse(fixture).tokens }), { status: 200 });
}) as unknown as typeof fetch;

const out = process.argv[2] ?? "../../out-b";
const store = FileStore.load(path.join(out, "state"));
await runRefresh({ store, fetchFn });
const files = await buildPublicFiles(store, new Date().toISOString());
fs.mkdirSync(out, { recursive: true });
for (const [rel, content] of files) {
  fs.mkdirSync(path.dirname(path.join(out, rel)), { recursive: true });
  fs.writeFileSync(path.join(out, rel), content);
}
store.save(path.join(out, "state"));
const sizes = [...files].map(([k, v]) => [k, v.length] as const).sort((a, b) => b[1] - a[1]).slice(0, 5);
console.log("files", files.size, "largest", JSON.stringify(sizes));
