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
  readings: Reading[];
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
  return {
    async get<T>(key: string) {
      return ((await s.get(key, { type: "json" })) as T | null) ?? null;
    },
    async set(key: string, value: unknown) {
      await s.set(key, JSON.stringify(value, bigintReplacer));
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
