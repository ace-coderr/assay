import {
  ageSec,
  check,
  DISCLAIMER,
  findReading,
  liveReading,
  probe,
  VERDICT_MAX_AGE_SEC,
  type ActionEvent,
  type LatestDoc,
  type Reading,
} from "@assay/core";
import type { AssayBackend } from "./index.js";

/** The orphan `data` branch the pipeline publishes to. Override with ASSAY_DATA_URL. */
export const DEFAULT_DATA_URL = "https://raw.githubusercontent.com/ace-coderr/assay/data";

export interface PublishedBackendOptions {
  dataUrl?: string;
  fetchFn?: typeof fetch;
  /** Re-reads a reading's pools on-chain. Injected in tests; defaults to the real public-RPC reader. */
  live?: (r: Reading) => Promise<Reading>;
  now?: () => number;
}

interface ActionsFile {
  actions: ActionEvent[];
  details?: Record<string, unknown>;
}

/**
 * Backend that reads the JSON published to the data branch and can re-read pools on-chain. Everything is read-only.
 * When a source is down the answer says so explicitly ("unavailable"); nothing is made up.
 */
export function publishedBackend(opts: PublishedBackendOptions = {}): AssayBackend {
  const dataUrl = (opts.dataUrl ?? process.env.ASSAY_DATA_URL ?? DEFAULT_DATA_URL).replace(/\/$/, "");
  const fetchFn = opts.fetchFn ?? fetch;
  const liveRead = opts.live ?? ((r: Reading) => liveReading(r));
  const now = opts.now ?? Date.now;

  async function getJson<T>(file: string): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
    try {
      const res = await fetchFn(`${dataUrl}/${file}`, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) return { ok: false, error: `${file}: HTTP ${res.status}` };
      return { ok: true, data: (await res.json()) as T };
    } catch (e) {
      return { ok: false, error: `${file}: ${e instanceof Error ? e.message : "network error"}` };
    }
  }
  const unavailable = (error: string) => ({ status: "unavailable", reason: `published data could not be read (${error})`, disclaimer: DISCLAIMER });

  /** Find the reading and, if asked, replace it with a fresh on-chain one. Falls back to the published reading, saying so. */
  async function resolve(symbol: string, wantLive: boolean) {
    const b = await getJson<LatestDoc>("board.json");
    if (!b.ok) return { error: b.error } as const;
    const published = findReading(b.data, symbol);
    let reading = published;
    let source: "published" | "live" = "published";
    let liveError: string | undefined;
    let readingAge = ageSec(published?.readAt, now());
    if (wantLive && published?.status === "ok") {
      try {
        reading = await liveRead(published);
        source = "live";
        readingAge = 0;
      } catch (e) {
        liveError = `live on-chain read failed (${e instanceof Error ? e.message : "error"}); using the published reading`;
      }
    }
    return { reading, source, liveError, readingAge, board: b.data } as const;
  }

  return {
    async board() {
      const b = await getJson<LatestDoc>("board.json");
      if (!b.ok) return unavailable(b.error);
      const d = b.data;
      return {
        updatedAt: d.updatedAt,
        ageSec: Math.round(ageSec(d.updatedAt, now())),
        sources: d.sources,
        untrackedTokens: d.untracked,
        readings: d.readings.map((r) => ({
          symbol: r.symbol,
          status: r.status,
          state: r.state,
          dexPrice: r.dexPrice,
          reference: r.reference,
          deviationBps: r.deviationBps,
          unavailableReason: r.unavailableReason,
          reasons: r.reasons,
        })),
        disclaimer: DISCLAIMER,
      };
    },
    async token(symbol, wantLive) {
      const r = await resolve(symbol, wantLive);
      if ("error" in r) return unavailable(r.error!);
      if (!r.reading) return { status: "unavailable", reason: `unknown symbol: ${symbol}`, disclaimer: DISCLAIMER };
      return { reading: r.reading, source: r.source, liveError: r.liveError, ageSec: Math.round(r.readingAge), disclaimer: DISCLAIMER };
    },
    async actions(symbol) {
      const a = await getJson<ActionsFile>("actions.json");
      if (!a.ok) return unavailable(a.error);
      const list = symbol ? a.data.actions.filter((x) => x.symbol.toLowerCase() === symbol.toLowerCase() || x.symbol.toLowerCase() === symbol.toLowerCase() + "c") : a.data.actions;
      return {
        actions: list.slice(0, 50).map((x) => ({ ...x, issuerRecord: x.actionId ? a.data.details?.[x.actionId] : undefined })),
        disclaimer: DISCLAIMER,
      };
    },
    async probe(symbol, usd, side, wantLive) {
      const r = await resolve(symbol, wantLive);
      if ("error" in r) return unavailable(r.error!);
      return { ...probe(r.reading, symbol, usd, side), source: r.source, liveError: r.liveError };
    },
    async check(symbol, usd, side, wantLive) {
      const r = await resolve(symbol, wantLive);
      if ("error" in r) return { verdict: "unknown", reasons: [`published data could not be read (${r.error})`], readOnly: true, disclaimer: DISCLAIMER, symbol };
      const v = check(r.reading, symbol, usd, side, r.readingAge);
      return { ...v, source: r.source, liveError: r.liveError, maxPublishedAgeSec: VERDICT_MAX_AGE_SEC };
    },
  };
}
