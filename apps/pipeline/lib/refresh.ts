import { createPublicClient, decodeAbiParameters, http, type PublicClient } from "viem";
import { base } from "viem/chains";
import {
  DEFAULT_RPCS,
  buildReading,
  discoverPools,
  fetchTokens,
  makeClient,
  readPools,
  toTokenRef,
  type ActionEvent,
  type HistoryPoint,
  type LatestDoc,
  type PoolRead,
  type Reading,
  type RunRecord,
  type StateEvent,
} from "@assay/core";
import type { Store } from "./store.js";

export const CORP_ACTION_API = "https://api.coinbase.com/v1/tokenized-stocks/corporate-actions/";
const HISTORY_CAP = 1008; // 7 days at a 10 minute cadence
const EVENT_CAP = 300;
const ACTION_CAP = 500;

const TOPIC_ANNOUNCEMENT = "0xccebf8218a62875909564adef86a6f4df81503cb617221e793357d62f8e813f7";
const TOPIC_UI_MULT = "0x2205df4534432b2f60654a3fdb48737ffdaf3e9edb1a498bd985bc026b15b055";
const LOG_CHUNK = 50_000n; // public RPC limit
const LOG_ADDR_BATCH = 10; // public RPC limit
const LOG_REQUESTS_PER_RUN = 12; // no 30 s function limit in Actions, so catch up faster than before
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const INITIAL_LOOKBACK = 600_000n; // about 14 days on Base (2s blocks)

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);
const UUID = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g;

export interface RefreshDeps {
  store: Store;
  client?: PublicClient;
  fetchFn?: typeof fetch;
  now?: Date;
}

/**
 * Runs one refresh and records its health (duration, per-step timing, failures) so problems
 * are visible in status.json instead of only in the Actions log. Failures are recorded, logged
 * and re-thrown: a failed run is a real error and is not disguised as success.
 */
export async function runRefresh(deps: RefreshDeps): Promise<LatestDoc> {
  const started = Date.now();
  const steps: Record<string, number> = {};
  const prevRun = await deps.store.get<RunRecord>("run").catch(() => null);
  try {
    const doc = await refreshOnce(deps, steps);
    await deps.store.set("run", { at: new Date().toISOString(), durationMs: Date.now() - started, ok: true, steps, consecutiveFailures: 0 } satisfies RunRecord).catch(() => undefined);
    return doc;
  } catch (e) {
    const rec: RunRecord = { at: new Date().toISOString(), durationMs: Date.now() - started, ok: false, error: msg(e), steps, consecutiveFailures: (prevRun?.consecutiveFailures ?? 0) + 1 };
    console.error("refresh failed", JSON.stringify(rec));
    await deps.store.set("run", rec).catch(() => undefined);
    throw e;
  }
}

async function refreshOnce({ store, client = makeClient(), fetchFn = fetch, now = new Date() }: RefreshDeps, steps: Record<string, number>): Promise<LatestDoc> {
  let mark = Date.now();
  const lap = (name: string) => {
    steps[name] = Date.now() - mark;
    mark = Date.now();
  };
  const prev = await store.get<LatestDoc>("latest");
  const at = now.toISOString();

  // 1. Token list + reference values (Coinbase Tokenized Stocks API).
  let tokens;
  try {
    tokens = (await fetchTokens(fetchFn)).map(toTokenRef);
  } catch (e) {
    // Source down: keep the last known readings but say so explicitly. Never invent values.
    const doc: LatestDoc = {
      updatedAt: prev?.updatedAt ?? at,
      block: prev?.block,
      untracked: prev?.untracked ?? 0,
      totalTokens: prev?.totalTokens ?? 0,
      untrackedTokens: prev?.untrackedTokens,
      readings: prev?.readings ?? [],
      sources: {
        tokensApi: { ok: false, at, error: msg(e) },
        rpc: prev?.sources.rpc ?? { ok: false, at, error: "not attempted" },
      },
    };
    await store.set("latest", doc);
    return doc;
  }

  lap("tokensApi");
  // 2. Multiplier change detection across ALL tokens.
  const prevMult = (await store.get<Record<string, number>>("multipliers")) ?? {};
  const nextMult: Record<string, number> = {};
  const actions = (await store.get<ActionEvent[]>("actions")) ?? [];
  const firstRun = Object.keys(prevMult).length === 0;
  for (const t of tokens) {
    nextMult[t.address] = t.multiplier;
    const before = prevMult[t.address];
    if (!firstRun && before != null && Math.abs(before - t.multiplier) > 1e-12) {
      actions.push({ kind: "multiplier-change-detected", symbol: t.symbol, address: t.address, detectedAt: at, old: before, new: t.multiplier });
    }
  }
  await store.set("multipliers", nextMult);

  // 3. Pools and readings for tokens that have a reference value.
  const refTokens = tokens.filter((t) => t.navPrice != null);
  let rpc: LatestDoc["sources"]["rpc"] = { ok: true, at };
  let block: string | undefined;
  const readings: Reading[] = [];
  let found: Awaited<ReturnType<typeof discoverPools>> = new Map();
  try {
    found = await discoverPools(client, refTokens);
  } catch (e) {
    rpc = { ok: false, at, error: `pool discovery failed: ${msg(e)}` };
  }
  lap("discoverPools");
  // Pool reads are independent per token: run them concurrently to keep the whole run well under the 30 s limit.
  const results = await mapLimit(
    refTokens,
    4,
    async (t): Promise<{ reading: Reading; block?: string; error?: string }> => {
      if (!rpc.ok) return { reading: unavailable(t.symbol, t.address, t.multiplier, at, "RPC unavailable: " + rpc.error) };
      try {
        const { pools, block: b } = await readPools(client, t, found.get(t.address) ?? []);
        return { reading: buildReading({ token: t, pools, now, block: String(b), previousMultiplier: prevMult[t.address] }), block: String(b) };
      } catch (e) {
        return { reading: unavailable(t.symbol, t.address, t.multiplier, at, "RPC read failed: " + msg(e)), error: msg(e) };
      }
    },
  );
  for (const r of results) {
    readings.push(r.reading);
    if (r.block) block = r.block;
    if (r.error) rpc = { ok: false, at, error: r.error };
  }
  lap("readPools");

  const doc: LatestDoc = {
    updatedAt: at,
    block,
    sources: { tokensApi: { ok: true, at }, rpc },
    untracked: tokens.length - refTokens.length,
    totalTokens: tokens.length,
    untrackedTokens: tokens.filter((t) => t.navPrice == null).map((t) => ({ symbol: t.symbol, multiplier: t.multiplier })),
    readings: serialisable(readings),
  };

  // 4. History + state-transition events.
  const events = (await store.get<StateEvent[]>("events")) ?? [];
  const newEvents: StateEvent[] = [];
  await Promise.all(
    doc.readings.map(async (r) => {
      if (r.status !== "ok") return;
      const key = `history:${r.symbol}`;
      const h = (await store.get<HistoryPoint[]>(key)) ?? [];
      h.push({ t: at, dex: r.dexPrice!, ref: r.reference!, devBps: r.deviationBps!, state: r.state!, depth: r.poolUsed!.usdcDepth });
      await store.set(key, h.slice(-HISTORY_CAP));
      const before = prev?.readings.find((p) => p.symbol === r.symbol);
      const from = before?.status === "ok" ? before.state! : null;
      if (from !== r.state) newEvents.push({ t: at, symbol: r.symbol, from, to: r.state!, reason: r.reasons[0] ?? "" });
    }),
  );
  await store.set("events", [...events, ...newEvents].slice(-EVENT_CAP));
  lap("history");

  // 5. Corporate-action events from chain logs (incremental, rate-limited).
  try {
    const scan = await scanActions(client, store, refTokens.concat(tokens.filter((t) => t.multiplier !== 1 && t.navPrice == null)), at);
    actions.push(...scan.events);
    await store.set("actions-error", scan.error ? { at, error: scan.error } : null);
  } catch (e) {
    await store.set("actions-error", { at, error: msg(e) });
  }
  await store.set("actions", dedupeActions(actions).slice(-ACTION_CAP));
  await store.set("latest", doc);
  lap("actionsScan+save");

  // 6. Issuer records for corporate actions. The Coinbase API sends no CORS headers, so the browser cannot
  // fetch them; the pipeline does, and publishes them with the actions.
  await fetchActionDetails(store, fetchFn, at).catch((e) => console.error("action details failed", msg(e)));
  lap("actionDetails");
  return doc;
}

export type ActionDetail = { status: "ok"; record: unknown; fetchedAt: string } | { status: "unavailable"; reason: string; fetchedAt: string };

/** Fetch the issuer record for each corporate-action id we know of. Successes are kept; failures are retried next run. */
export async function fetchActionDetails(store: Store, fetchFn: typeof fetch, at: string, maxPerRun = 15): Promise<void> {
  const actions = (await store.get<ActionEvent[]>("actions")) ?? [];
  const details = (await store.get<Record<string, ActionDetail>>("actionDetails")) ?? {};
  const todo = [...new Set(actions.map((a) => a.actionId).filter((x): x is string => !!x))].filter((id) => details[id]?.status !== "ok").slice(0, maxPerRun);
  for (const id of todo) {
    try {
      const res = await fetchFn(CORP_ACTION_API + id, { signal: AbortSignal.timeout(10_000) });
      details[id] = res.ok
        ? { status: "ok", record: await res.json(), fetchedAt: at }
        : { status: "unavailable", reason: res.status === 404 ? "the Tokenized Stocks API has no record for this action id" : `the Tokenized Stocks API answered HTTP ${res.status}`, fetchedAt: at };
    } catch (e) {
      details[id] = { status: "unavailable", reason: `issuer record source did not respond: ${msg(e)}`, fetchedAt: at };
    }
  }
  if (todo.length) await store.set("actionDetails", details);
}

function unavailable(symbol: string, address: `0x${string}`, multiplier: number, readAt: string, why: string): Reading {
  return { symbol, address, multiplier, status: "unavailable", unavailableCode: "source-error", unavailableReason: why, reasons: [], poolsConsidered: 0, poolsRejected: [], readAt };
}

/** Runs `fn` over `items` with at most `limit` in flight, preserving order. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]!);
      }
    }),
  );
  return out;
}

/** JSON-safe copy (bigints to strings) typed as Reading for consumers. */
function serialisable(rs: Reading[]): Reading[] {
  return JSON.parse(JSON.stringify(rs, (_k, v) => (typeof v === "bigint" ? v.toString() : v))) as Reading[];
}

function dedupeActions(list: ActionEvent[]): ActionEvent[] {
  const seen = new Set<string>();
  return list.filter((a) => {
    const k = `${a.kind}|${a.address}|${a.tx ?? a.detectedAt}|${a.id ?? ""}|${a.new ?? ""}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

async function scanActions(
  client: PublicClient,
  store: Store,
  tokens: { address: `0x${string}`; symbol: string }[],
  detectedAt: string,
): Promise<{ events: ActionEvent[]; error?: string }> {
  const uniq = [...new Map(tokens.map((t) => [t.address.toLowerCase(), t])).values()];
  if (!uniq.length) return { events: [] };
  const head = await client.getBlockNumber();
  const cur = await store.get<{ block: string }>("actions-cursor");
  let from = cur ? BigInt(cur.block) + 1n : head - INITIAL_LOOKBACK;
  const out: ActionEvent[] = [];
  const bySym = new Map(uniq.map((t) => [t.address.toLowerCase(), t.symbol]));
  let requests = 0;
  const startFrom = from;
  let error: string | undefined;
  let scannedTo = from - 1n;
  while (from <= head && requests < LOG_REQUESTS_PER_RUN) {
    const to = from + LOG_CHUNK - 1n > head ? head : from + LOG_CHUNK - 1n;
    const chunk: ActionEvent[] = [];
    try {
      for (let i = 0; i < uniq.length; i += LOG_ADDR_BATCH) {
        const batch = uniq.slice(i, i + LOG_ADDR_BATCH).map((t) => t.address);
        const logs = await getLogsResilient({
          address: batch,
          topics: [[TOPIC_ANNOUNCEMENT, TOPIC_UI_MULT]],
          fromBlock: `0x${from.toString(16)}`,
          toBlock: `0x${to.toString(16)}`,
        });
        requests++;
        await sleep(300);
        for (const l of logs) chunk.push(decodeLog(l, bySym.get(l.address.toLowerCase()) ?? "?", detectedAt));
      }
    } catch (e) {
      // Keep the progress made so far; the failed chunk is retried on the next run.
      error = msg(e);
      break;
    }
    out.push(...chunk);
    scannedTo = to;
    from = to + 1n;
  }
  if (scannedTo >= startFrom) await store.set("actions-cursor", { block: scannedTo.toString(), head: head.toString() });
  return { events: out, error };
}

type RawLog = { address: string; topics: string[]; data: `0x${string}`; blockNumber: string; transactionHash: string };

/** eth_getLogs against each public RPC in turn, reporting every endpoint error (viem fallback keeps only the last). */
async function getLogsResilient(filter: Record<string, unknown>): Promise<RawLog[]> {
  const errors: string[] = [];
  for (const url of DEFAULT_RPCS) {
    const c = createPublicClient({ chain: base, transport: http(url, { timeout: 12_000, retryCount: 0 }) });
    try {
      return (await c.request({ method: "eth_getLogs", params: [filter] } as never)) as RawLog[];
    } catch (e) {
      errors.push(`${new URL(url).host}: ${msg(e).slice(0, 110)}`);
      await sleep(400);
    }
  }
  throw new Error(errors.join(" | "));
}

export function decodeLog(
  l: { address: string; topics: string[]; data: `0x${string}`; blockNumber: string; transactionHash: string },
  symbol: string,
  detectedAt: string,
): ActionEvent {
  const base = { symbol, address: l.address, block: BigInt(l.blockNumber).toString(), tx: l.transactionHash, detectedAt };
  if (l.topics[0] === TOPIC_ANNOUNCEMENT) {
    const [id, description, uri] = decodeAbiParameters(
      [{ type: "string" }, { type: "string" }, { type: "string" }],
      l.data,
    ) as [string, string, string];
    const uuids = uri.match(UUID);
    return { kind: "announcement", ...base, id, description, uri, actionId: uuids?.[uuids.length - 1] };
  }
  const [oldM, newM, eff] = decodeAbiParameters([{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }], l.data) as [bigint, bigint, bigint];
  return {
    kind: "multiplier-scheduled",
    ...base,
    old: Number(oldM) / 1e18,
    new: Number(newM) / 1e18,
    effectiveAt: new Date(Number(eff) * 1000).toISOString(),
  };
}

export type { PoolRead };
