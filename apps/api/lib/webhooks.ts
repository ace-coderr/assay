import { createHmac, createHash, randomBytes } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { StateEvent, WebhookRec } from "./store.js";

export const MAX_WEBHOOKS = 200;

function isPrivateIp(ip: string): boolean {
  if (ip.includes(":")) {
    const l = ip.toLowerCase();
    return l === "::1" || l === "::" || l.startsWith("fc") || l.startsWith("fd") || l.startsWith("fe80") || l.startsWith("::ffff:127.") || l.startsWith("::ffff:10.") || l.startsWith("::ffff:192.168.");
  }
  const [a, b] = ip.split(".").map(Number) as [number, number];
  return a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

/** SSRF guard: https only, no credentials, no private/loopback/link-local targets (checked after DNS). */
export async function assertSafeWebhookUrl(raw: string): Promise<URL> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("invalid URL");
  }
  if (u.protocol !== "https:") throw new Error("webhook URL must be https");
  if (u.username || u.password) throw new Error("credentials in URL are not allowed");
  if (u.port && u.port !== "443") throw new Error("only port 443 is allowed");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) throw new Error("host not allowed");
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) throw new Error("host resolves to a non-public address");
  return u;
}

export function newSecret() {
  const secret = randomBytes(24).toString("hex");
  return { secret, secretHash: createHash("sha256").update(secret).digest("hex") };
}

export const hashSecret = (s: string) => createHash("sha256").update(s).digest("hex");

/** POST events to subscribers. Signed with HMAC-SHA256 using the subscriber's secret hash as key id only; body is public data. */
export async function deliverWebhooks(hooks: WebhookRec[], events: StateEvent[], fetchFn: typeof fetch): Promise<WebhookRec[]> {
  const out: WebhookRec[] = [];
  for (const h of hooks) {
    const mine = events.filter((e) => h.symbols.length === 0 || h.symbols.includes(e.symbol));
    if (!mine.length) {
      out.push(h);
      continue;
    }
    const body = JSON.stringify({ source: "assay", events: mine });
    try {
      const u = await assertSafeWebhookUrl(h.url); // re-check at delivery time (DNS may have changed)
      const sig = createHmac("sha256", h.secretHash).update(body).digest("hex");
      const res = await fetchFn(u, {
        method: "POST",
        headers: { "content-type": "application/json", "x-assay-signature": sig },
        body,
        redirect: "manual",
        signal: AbortSignal.timeout(5000),
      });
      out.push({ ...h, failures: res.ok ? 0 : h.failures + 1 });
    } catch {
      out.push({ ...h, failures: h.failures + 1 });
    }
  }
  return out.filter((h) => h.failures < 10); // drop dead endpoints
}
