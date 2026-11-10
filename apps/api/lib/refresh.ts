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
  type PoolRead,
  type Reading,
} from "@assay/core";
import type { ActionEvent, HistoryPoint, LatestDoc, StateEvent, Store, WebhookRec } from "./store.js";
import { deliverWebhooks } from "./webhooks.js";

const HISTORY_CAP = 2016; // 7 days at 5 minute cadence
const EVENT_CAP = 300;
const ACTION_CAP = 500;

const TOPIC_ANNOUNCEMENT = "0xccebf8218a62875909564adef86a6f4df81503cb617221e793357d62f8e813f7";
const TOPIC_UI_MULT = "0x2205df4534432b2f60654a3fdb48737ffdaf3e9edb1a498bd985bc026b15b055";
const LOG_CHUNK = 50_000n; // public RPC limit
const LOG_ADDR_BATCH = 10; // public RPC limit
const LOG_REQUESTS_PER_RUN = 4;
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

export async function runRefresh({ store, client = makeClient(), fetchFn = fetch, now = new Date() }: RefreshDeps): Promise<LatestDoc> {
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
      readings: prev?.readings ?? [],
      sources: {
        tokensApi: { ok: false, at, error: msg(e) },
        rpc: prev?.sources.rpc ?? { ok: false, at, error: "not attempted" },
      },
    };
    await store.set("latest", doc);
    return doc;
  }

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
  for (const t of refTokens) {
    const base = { previousMultiplier: prevMult[t.address] };
    if (!rpc.ok) {
      readings.push(unavailable(t.symbol, t.address, t.multiplier, at, "RPC unavailable: " + rpc.error));
      continue;
    }
    try {
      const { pools, block: b } = await readPools(client, t, found.get(t.address) ?? []);
      block = String(b);
      readings.push(buildReading({ token: t, pools, now, block, ...base }));
    } catch (e) {
      rpc = { ok: false, at, error: msg(e) };
      readings.push(unavailable(t.symbol, t.address, t.multiplier, at, "RPC read failed: " + msg(e)));
    }
  }

  const doc: LatestDoc = {
    updatedAt: at,
    block,
    sources: { tokensApi: { ok: true, at }, rpc },
    untracked: tokens.length - refTokens.length,
    totalTokens: tokens.length,
    readings: serialisable(readings),
  };

  // 4. History + state-transition events.
  const events = (await store.get<StateEvent[]>("events")) ?? [];
  const newEvents: StateEvent[] = [];
  for (const r of doc.readings) {
    if (r.status !== "ok") continue;
    const key = `history:${r.symbol}`;
    const h = (await store.get<HistoryPoint[]>(key)) ?? [];
    h.push({ t: at, dex: r.dexPrice!, ref: r.reference!, devBps: r.deviationBps!, state: r.state!, depth: r.poolUsed!.usdcDepth });
    await store.set(key, h.slice(-HISTORY_CAP));
    const before = prev?.readings.find((p) => p.symbol === r.symbol);
    const from = before?.status === "ok" ? before.state! : null;
    if (from !== r.state) newEvents.push({ t: at, symbol: r.symbol, from, to: r.state!, reason: r.reasons[0] ?? "" });
  }
  await store.set("events", [...events, ...newEvents].slice(-EVENT_CAP));

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

  // 6. Webhooks (best effort; failures never block a reading).
  if (newEvents.length) {
    const hooks = (await store.get<WebhookRec[]>("webhooks")) ?? [];
    if (hooks.length) await store.set("webhooks", await deliverWebhooks(hooks, newEvents, fetchFn));
  }
  return doc;
}

function unavailable(symbol: string, address: `0x${string}`, multiplier: number, readAt: string, why: string): Reading {
  return { symbol, address, multiplier, status: "unavailable", unavailableReason: why, reasons: [], poolsConsidered: 0, poolsRejected: [], readAt };
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
