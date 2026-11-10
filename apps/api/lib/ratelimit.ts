/**
 * Best-effort per-instance token bucket. Serverless instances do not share memory, so
 * this limits bursts hitting one warm instance; sustained abuse is bounded by CDN caching
 * of GET responses and by the platform's own limits. It is not a global quota.
 */
const buckets = new Map<string, { tokens: number; at: number }>();

export function allow(key: string, perMinute: number, now = Date.now()): boolean {
  if (buckets.size > 5000) buckets.clear();
  const b = buckets.get(key) ?? { tokens: perMinute, at: now };
  b.tokens = Math.min(perMinute, b.tokens + ((now - b.at) / 60_000) * perMinute);
  b.at = now;
  if (b.tokens < 1) {
    buckets.set(key, b);
    return false;
  }
  b.tokens -= 1;
  buckets.set(key, b);
  return true;
}

export function clientKey(req: Request): string {
  return req.headers.get("x-nf-client-connection-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "anon";
}
