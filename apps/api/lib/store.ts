import { getStore } from "@netlify/blobs";
import type { Reading } from "@assay/core";

export interface SourceStatus {
  ok: boolean;
  at: string;
  error?: string;
}

export interface LatestDoc {
  updatedAt: string;
  block?: string;
  sources: { tokensApi: SourceStatus; rpc: SourceStatus };
  /** Count of tokens in the Tokenized Stocks API with no reference value (cannot be assayed). */
  untracked: number;
  totalTokens: number;
  /** Tokens in the Tokenized Stocks API with no reference value, so requests for them can get an explained state, not an error. */
  untrackedTokens?: { symbol: string; multiplier: number }[];
  readings: Reading[];
}

/** Health record of the last scheduled run, exposed on /api/status so failures are visible. */
export interface RunRecord {
  at: string;
  durationMs: number;
  ok: boolean;
  error?: string;
  steps: Record<string, number>;
  consecutiveFailures: number;
}

export interface HistoryPoint {
  t: string;
  dex: number;
  ref: number;
  devBps: number;
  state: string;
  depth: number;
}

export interface StateEvent {
  t: string;
  symbol: string;
  from: string | null;
  to: string;
  reason: string;
}

export interface ActionEvent {
  kind: "announcement" | "multiplier-scheduled" | "multiplier-change-detected";
  symbol: string;
  address: string;
  block?: string;
  tx?: string;
  detectedAt: string;
  id?: string;
  description?: string;
  uri?: string;
  actionId?: string;
  old?: number;
  new?: number;
  effectiveAt?: string;
}

export interface WebhookRec {
  id: string;
  url: string;
  symbols: string[];
  secretHash: string;
  createdAt: string;
  failures: number;
}

export const bigintReplacer = (_k: string, v: unknown) => (typeof v === "bigint" ? v.toString() : v);

export interface Store {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown): Promise<void>;
}

export function openStore(): Store {
  const s = getStore({ name: "assay", consistency: "strong" });
  // One retry: Blobs occasionally fails transiently, and a read or write error would surface as a 5xx.
  const retry = async <T>(fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch {
      await new Promise((r) => setTimeout(r, 150));
      return fn();
    }
  };
  return {
    async get<T>(key: string) {
      return retry(async () => ((await s.get(key, { type: "json" })) as T | null) ?? null);
    },
    async set(key: string, value: unknown) {
      await retry(() => s.set(key, JSON.stringify(value, bigintReplacer)));
    },
  };
}

/** In-memory store for tests. */
export function memoryStore(): Store {
  const m = new Map<string, string>();
  return {
    async get<T>(key: string) {
      const v = m.get(key);
      return v ? (JSON.parse(v) as T) : null;
    },
    async set(key: string, value: unknown) {
      m.set(key, JSON.stringify(value, bigintReplacer));
    },
  };
}
