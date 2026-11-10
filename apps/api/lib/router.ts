import { randomUUID } from "node:crypto";
import type { Store, WebhookRec } from "./store.js";
import { getLatest, getHistory, getActions, getEvents, findReading, probe, check, parseSize, parseSide, thresholdsDoc, ageSec } from "./service.js";
import { runRefresh } from "./refresh.js";
import { assertSafeWebhookUrl, hashSecret, newSecret, MAX_WEBHOOKS } from "./webhooks.js";
import { allow, clientKey } from "./ratelimit.js";
import { DISCLAIMER } from "@assay/core";

const CORP_ACTION_API = "https://api.coinbase.com/v1/tokenized-stocks/corporate-actions/";
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const SYMBOL_RE = /^[A-Za-z0-9.]{1,12}$/;

const json = (data: unknown, status = 200, cacheSec = 0) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "x-content-type-options": "nosniff",
      "cache-control": cacheSec ? `public, max-age=${cacheSec}, s-maxage=${cacheSec}` : "no-store",
    },
  });

const err = (status: number, message: string) => json({ error: message }, status);
const esc = (s: string) => s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]!);

export async function handle(req: Request, store: Store, fetchFn: typeof fetch = fetch): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/api\/?/, "").replace(/\/$/, "");
  const seg = path.split("/");

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "GET,POST,DELETE,OPTIONS", "access-control-allow-headers": "content-type" } });
  }
  if (!allow(clientKey(req), 120)) return json({ error: "rate limit exceeded: 120 requests per minute" }, 429);

  try {
    if (req.method === "GET") {
      let doc = await getLatest(store);
      // Cold start: nothing stored yet. Take one reading now so the site works before the first scheduled run.
      if (!doc && ["board", "token", "status", "probe", "check"].includes(seg[0]!)) {
        if (allow("cold-refresh", 2)) doc = await runRefresh({ store, fetchFn });
      }
      switch (seg[0]) {
        case "status":
          return json({
            updatedAt: doc?.updatedAt ?? null,
            ageSec: Number.isFinite(ageSec(doc)) ? Math.round(ageSec(doc)) : null,
            block: doc?.block ?? null,
            network: "Base mainnet (8453)",
            sources: doc?.sources ?? null,
            refresh: await store.get("run"),
            tracked: doc?.readings.length ?? 0,
            assayable: doc?.readings.filter((r) => r.status === "ok").length ?? 0,
            untracked: doc?.untracked ?? null,
            totalTokens: doc?.totalTokens ?? null,
            thresholds: thresholdsDoc(),
            disclaimer: DISCLAIMER,
          }, 200, 15);
        case "board":
          return doc ? json({ ...doc, ageSec: Math.round(ageSec(doc)), disclaimer: DISCLAIMER }, 200, 15) : json({ error: "no readings yet", unavailable: true }, 503);
        case "token": {
          const sym = seg[1] ?? "";
          if (!SYMBOL_RE.test(sym)) return err(400, "bad symbol");
          const reading = findReading(doc, sym);
          if (!reading) return err(404, "unknown or untracked symbol");
          return json({
            reading,
            history: await getHistory(store, reading.symbol, 96),
            actions: (await getActions(store, reading.symbol)).slice(0, 20),
            sources: doc!.sources,
            ageSec: Math.round(ageSec(doc)),
            disclaimer: DISCLAIMER,
          }, 200, 15);
        }
        case "history": {
          const sym = seg[1] ?? "";
          if (!SYMBOL_RE.test(sym)) return err(400, "bad symbol");
          const reading = findReading(doc, sym);
          if (!reading) return err(404, "unknown or untracked symbol");
          return json({ symbol: reading.symbol, points: await getHistory(store, reading.symbol, Number(url.searchParams.get("limit") ?? 288) || 288) }, 200, 30);
        }
        case "actions": {
          if (seg[1]) {
            if (!UUID_RE.test(seg[1])) return err(400, "bad corporate action id");
            // The issuer record is a third-party lookup: relay it when it exists, otherwise explain, never pass an upstream error through.
            let up: Response;
            try {
              up = await fetchFn(CORP_ACTION_API + seg[1], { signal: AbortSignal.timeout(10_000) });
            } catch (e) {
              return json({ status: "unavailable", reason: "issuer record source did not respond", detail: e instanceof Error ? e.message.slice(0, 120) : "network error" }, 200, 30);
            }
            if (!up.ok) {
              return json({ status: "unavailable", reason: up.status === 404 ? "the Tokenized Stocks API has no record for this action id" : `the Tokenized Stocks API answered HTTP ${up.status}`, upstreamStatus: up.status }, 200, 30);
            }
            return new Response(await up.text(), { headers: { "content-type": "application/json", "access-control-allow-origin": "*", "cache-control": "public, max-age=60" } });
          }
          const sym = url.searchParams.get("symbol") ?? undefined;
          if (sym && !SYMBOL_RE.test(sym)) return err(400, "bad symbol");
          return json({ actions: await getActions(store, sym), note: "Detected from onchain Announcement / UIMultiplierUpdated events and multiplier changes seen between readings. History starts at the first scanned block." , cursor: await store.get("actions-cursor"), scanError: await store.get("actions-error") }, 200, 30);
        }
        case "events":
          return json({ events: await getEvents(store) }, 200, 15);
        case "probe": {
          const usd = parseSize(url.searchParams.get("usd") ?? "1000");
          const side = parseSide(url.searchParams.get("side"));
          if (typeof usd === "object") return err(400, usd.error);
          if (typeof side === "object") return err(400, side.error);
          const sym = url.searchParams.get("symbol") ?? "";
          if (!SYMBOL_RE.test(sym)) return err(400, "bad symbol");
          const r = probe(doc, sym, usd, side);
          // "unavailable" is an explained answer to a valid request (HTTP 200); only an unknown symbol is a 404.
          return json(r, r.ok || r.status === "unavailable" ? 200 : 404, 10);
        }
        case "check": {
          const usdRaw = url.searchParams.get("usd");
          const usd = usdRaw ? parseSize(usdRaw) : undefined;
          const side = parseSide(url.searchParams.get("side"));
          if (typeof usd === "object") return err(400, usd.error);
          if (typeof side === "object") return err(400, side.error);
          const sym = url.searchParams.get("symbol") ?? "";
          if (!SYMBOL_RE.test(sym)) return err(400, "bad symbol");
          return json(check(doc, sym, usd, side), 200, 10);
        }
        case "feed.xml": {
          const events = (await getEvents(store)).slice(0, 50);
          const origin = url.origin;
          const items = events.map((e) => `<item><title>${esc(`${e.symbol}: ${e.from ?? "new"} to ${e.to}`)}</title><link>${esc(origin)}/token/${esc(e.symbol)}</link><guid isPermaLink="false">${esc(e.symbol + e.t)}</guid><pubDate>${new Date(e.t).toUTCString()}</pubDate><description>${esc(e.reason)}</description></item>`).join("");
          const xml = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Assay state changes</title><link>${esc(origin)}</link><description>Fresh / Stale / Drifting / Broken transitions for tokenized stocks on Base. Not financial advice.</description>${items}</channel></rss>`;
          return new Response(xml, { headers: { "content-type": "application/rss+xml; charset=utf-8", "cache-control": "public, max-age=60", "access-control-allow-origin": "*" } });
        }
      }
    }

    if (seg[0] === "webhooks") {
      if (req.method === "POST") {
        if (!allow("webhook-reg:" + clientKey(req), 5)) return err(429, "too many registrations");
        const body = (await req.json().catch(() => null)) as { url?: string; symbols?: string[] } | null;
        if (!body?.url) return err(400, "url required");
        const symbols = (body.symbols ?? []).filter((s) => typeof s === "string" && SYMBOL_RE.test(s)).slice(0, 20);
        let safe: URL;
        try {
          safe = await assertSafeWebhookUrl(body.url);
        } catch (e) {
          return err(400, e instanceof Error ? e.message : "bad url");
        }
        const hooks = (await store.get<WebhookRec[]>("webhooks")) ?? [];
        if (hooks.length >= MAX_WEBHOOKS) return err(503, "webhook capacity reached");
        const { secret, secretHash } = newSecret();
        const rec: WebhookRec = { id: randomUUID(), url: safe.toString(), symbols, secretHash, createdAt: new Date().toISOString(), failures: 0 };
        await store.set("webhooks", [...hooks, rec]);
        return json({ id: rec.id, secret, note: "Store the secret: it is shown once. Deliveries carry x-assay-signature = HMAC-SHA256(body, sha256(secret))." }, 201);
      }
      if (req.method === "DELETE") {
        const id = url.searchParams.get("id");
        const secret = url.searchParams.get("secret");
        const hooks = (await store.get<WebhookRec[]>("webhooks")) ?? [];
        const h = hooks.find((x) => x.id === id);
        if (!h || !secret || h.secretHash !== hashSecret(secret)) return err(404, "not found");
        await store.set("webhooks", hooks.filter((x) => x.id !== id));
        return json({ deleted: true });
      }
    }
    return err(404, "not found");
  } catch (e) {
    console.error("api error", req.method, url.pathname, e instanceof Error ? e.message : e);
    return json({ error: "internal error", detail: e instanceof Error ? e.message.slice(0, 200) : "unknown" }, 500);
  }
}
