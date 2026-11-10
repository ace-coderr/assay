import { useCallback, useEffect, useRef, useState } from "react";
import type { Reading } from "@assay/core";

export type { Reading };

export interface SourceStatus { ok: boolean; at: string; error?: string }
export interface Board {
  updatedAt: string;
  ageSec: number;
  block?: string;
  sources: { tokensApi: SourceStatus; rpc: SourceStatus };
  untracked: number;
  totalTokens: number;
  readings: Reading[];
  disclaimer: string;
}
export interface Status {
  updatedAt: string | null;
  ageSec: number | null;
  block: string | null;
  network: string;
  sources: Board["sources"] | null;
  refresh?: { at: string; durationMs: number; ok: boolean; error?: string; steps: Record<string, number>; consecutiveFailures: number } | null;
  assayable?: number;
  tracked: number;
  untracked: number | null;
  totalTokens: number | null;
  thresholds: Record<string, any>;
}
export interface HistoryPoint { t: string; dex: number; ref: number; devBps: number; state: string; depth: number }
export interface ActionEvent {
  kind: string; symbol: string; address: string; block?: string; tx?: string; detectedAt: string;
  id?: string; description?: string; uri?: string; actionId?: string; old?: number; new?: number; effectiveAt?: string;
}

export interface Result<T> { data: T | null; error: string | null; loading: boolean; reload: () => void; fetchedAt: number | null }

/** Fetches JSON from the Assay API. Errors are surfaced, never replaced with fake data. */
export function useApi<T>(path: string | null, refreshMs = 0): Result<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  const alive = useRef(true);

  const load = useCallback(async () => {
    if (!path) return;
    try {
      const res = await fetch(path, { headers: { accept: "application/json" } });
      const j = await res.json().catch(() => null);
      if (!alive.current) return;
      if (!res.ok) {
        setError((j && (j.error as string)) || `HTTP ${res.status}`);
      } else {
        setData(j as T);
        setError(null);
        setFetchedAt(Date.now());
      }
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : "network error");
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    alive.current = true;
    setLoading(true);
    setData(null);
    setError(null);
    void load();
    if (!refreshMs) return () => { alive.current = false; };
    const id = setInterval(load, refreshMs);
    return () => { alive.current = false; clearInterval(id); };
  }, [load, refreshMs]);

  return { data, error, loading, reload: load, fetchedAt };
}

export const MCP_URL = () => `${location.origin}/mcp`;

export function fmtPrice(n: number | undefined | null, d = 2): string {
  return n == null || !Number.isFinite(n) ? "n/a" : n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}
export function fmtBps(n: number | undefined | null): string {
  return n == null ? "n/a" : `${n > 0 ? "+" : ""}${n.toFixed(0)} bps`;
}
export function fmtAge(sec: number | undefined | null): string {
  if (sec == null || !Number.isFinite(sec)) return "n/a";
  if (sec < 90) return `${Math.round(sec)}s`;
  if (sec < 5400) return `${Math.round(sec / 60)}m`;
  if (sec < 172800) return `${(sec / 3600).toFixed(1)}h`;
  return `${Math.round(sec / 86400)}d`;
}
export function fmtUsd(n: number | undefined | null): string {
  return n == null ? "n/a" : "$" + n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}
export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
export const explorer = (a: string) => `https://basescan.org/address/${a}`;
export const explorerTx = (h: string) => `https://basescan.org/tx/${h}`;
