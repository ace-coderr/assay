import { describe, expect, it } from "vitest";
import { DataSource } from "../src/index.js";

const SHA1 = "a".repeat(40);
const SHA2 = "b".repeat(40);

/** A fake network: the GitHub ref API, SHA-pinned raw files, and a branch URL that can be stale. */
function net(opts: { head: () => string; branchBody?: string; apiStatus?: number; deadShas?: Set<string> }) {
  const calls: string[] = [];
  const fetchFn = (async (url: string | URL) => {
    const u = String(url);
    calls.push(u);
    if (u.includes("api.github.com")) {
      return (opts.apiStatus ?? 200) === 200 ? new Response(JSON.stringify({ object: { sha: opts.head() } })) : new Response("rate limited", { status: opts.apiStatus });
    }
    const m = u.match(/assay\/([^/]+)\/(.+)$/)!;
    const [, ref, file] = m;
    if (ref === "data") return new Response(opts.branchBody ?? "stale", { status: 200 });
    if (opts.deadShas?.has(ref!)) return new Response("gone", { status: 404 });
    return new Response(`fresh:${ref!.slice(0, 1)}:${file}`, { status: 200 });
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
}

describe("DataSource", () => {
  it("reads by commit SHA, so a stale branch URL is never used", async () => {
    const n = net({ head: () => SHA1, branchBody: "STALE-COPY" });
    const ds = new DataSource({ fetchFn: n.fetchFn });
    const body = await (await ds.fetch("board.json")).text();
    expect(body).toBe("fresh:a:board.json");
    expect(n.calls.some((c) => c.endsWith("/data/board.json"))).toBe(false);
  });

  it("caches the resolved commit for the ttl and re-resolves after it", async () => {
    let t = 0;
    let head = SHA1;
    const n = net({ head: () => head });
    const ds = new DataSource({ fetchFn: n.fetchFn, ttlMs: 1000, now: () => t });
    await ds.fetch("a.json");
    await ds.fetch("b.json");
    expect(n.calls.filter((c) => c.includes("api.github.com"))).toHaveLength(1);
    t = 2000;
    head = SHA2;
    expect(await (await ds.fetch("a.json")).text()).toBe("fresh:b:a.json");
    expect(n.calls.filter((c) => c.includes("api.github.com"))).toHaveLength(2);
  });

  it("falls back to the branch URL when the GitHub API is rate limited", async () => {
    const n = net({ head: () => SHA1, apiStatus: 403, branchBody: "BRANCH" });
    const ds = new DataSource({ fetchFn: n.fetchFn });
    expect(await (await ds.fetch("board.json")).text()).toBe("BRANCH");
  });

  it("when a pinned commit disappears after a force-push, re-resolves once and retries", async () => {
    let head = SHA1;
    const dead = new Set<string>();
    const n = net({ head: () => head, deadShas: dead });
    const ds = new DataSource({ fetchFn: n.fetchFn, ttlMs: 60_000 });
    await ds.fetch("board.json"); // pins SHA1
    dead.add(SHA1);
    head = SHA2; // the branch moved on and the old commit is gone
    expect(await (await ds.fetch("board.json")).text()).toBe("fresh:b:board.json");
  });

  it("a fixed root is used as given and never calls the GitHub API", async () => {
    const n = net({ head: () => SHA1 });
    const ds = new DataSource({ fetchFn: n.fetchFn, fixedRoot: "https://raw.githubusercontent.com/ace-coderr/assay/data/" });
    await ds.fetch("board.json");
    expect(n.calls.some((c) => c.includes("api.github.com"))).toBe(false);
  });
});
