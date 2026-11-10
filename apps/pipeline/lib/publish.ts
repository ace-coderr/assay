import { CADENCE_MIN, DISCLAIMER, thresholdsDoc, type ActionEvent, type HistoryPoint, type LatestDoc, type RunRecord, type StateEvent } from "@assay/core";
import type { ActionDetail } from "./refresh.js";
import type { Store } from "./store.js";

export const SITE_URL = "https://ace-coderr.github.io/assay/";

const esc = (s: string) => s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]!);
const json = (v: unknown) => JSON.stringify(v);

/**
 * Turns the pipeline state into the public JSON files the website and MCP server read.
 * Returns relative path -> file content; the caller writes them. No secrets, no per-user data.
 */
export async function buildPublicFiles(store: Store, generatedAt: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  const doc = await store.get<LatestDoc>("latest");
  if (!doc) throw new Error("no latest reading to publish");
  const run = await store.get<RunRecord>("run");
  const events = ((await store.get<StateEvent[]>("events")) ?? []).slice().reverse();
  const actions = ((await store.get<ActionEvent[]>("actions")) ?? []).slice().reverse();
  const details = (await store.get<Record<string, ActionDetail>>("actionDetails")) ?? {};
  const cursor = await store.get("actions-cursor");
  const scanError = await store.get("actions-error");

  files.set("board.json", json({ ...doc, generatedAt, disclaimer: DISCLAIMER }));

  files.set(
    "status.json",
    json({
      generatedAt,
      updatedAt: doc.updatedAt,
      block: doc.block ?? null,
      network: "Base mainnet (8453)",
      cadenceMin: CADENCE_MIN,
      sources: doc.sources,
      refresh: run,
      tracked: doc.readings.length,
      assayable: doc.readings.filter((r) => r.status === "ok").length,
      untracked: doc.untracked,
      totalTokens: doc.totalTokens,
      thresholds: thresholdsDoc(),
      disclaimer: DISCLAIMER,
    }),
  );

  for (const r of doc.readings) {
    const history = (await store.get<HistoryPoint[]>(`history:${r.symbol}`)) ?? [];
    files.set(
      `token/${r.symbol}.json`,
      json({
        reading: r,
        history: history.slice(-144), // last day at 10 minute cadence
        actions: actions.filter((a) => a.symbol === r.symbol).slice(0, 20),
        sources: doc.sources,
        updatedAt: doc.updatedAt,
        disclaimer: DISCLAIMER,
      }),
    );
    files.set(`history/${r.symbol}.json`, json({ symbol: r.symbol, points: history }));
  }

  files.set(
    "actions.json",
    json({
      actions,
      details,
      note: "Detected from onchain Announcement / UIMultiplierUpdated events and multiplier changes seen between readings. History starts at the first scanned block.",
      cursor,
      scanError,
      generatedAt,
    }),
  );
  files.set("events.json", json({ events, generatedAt }));

  const items = events
    .slice(0, 50)
    .map(
      (e) =>
        `<item><title>${esc(`${e.symbol}: ${e.from ?? "new"} to ${e.to}`)}</title><link>${esc(SITE_URL)}#/app/token/${esc(e.symbol)}</link><guid isPermaLink="false">${esc(e.symbol + e.t)}</guid><pubDate>${new Date(e.t).toUTCString()}</pubDate><description>${esc(e.reason)}</description></item>`,
    )
    .join("");
  files.set(
    "feed.xml",
    `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Assay state changes</title><link>${esc(SITE_URL)}</link><description>Fresh / Stale / Drifting / Broken transitions for tokenized stocks on Base. Not financial advice.</description>${items}</channel></rss>`,
  );
  return files;
}
