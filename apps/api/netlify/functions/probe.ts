// Recon probe: fetches the public Tokenized Stocks API from Netlify's servers
// and returns the raw upstream response. Read-only, GET only, fixed host,
// allowlisted paths only.
const BASE = "https://api.coinbase.com/v1/tokenized-stocks";
const ALLOWED = [
  /^$/,
  /^\/chains$/,
  /^\/total-supply\/0x[a-fA-F0-9]{40}$/,
  /^\/corporate-actions\/[0-9a-fA-F-]{36}$/,
  /^\/metadata\/[A-Za-z0-9.-]{1,16}$/,
];

export default async (req: Request): Promise<Response> => {
  const u = new URL(req.url);
  const path = u.searchParams.get("path") ?? "";
  if (!ALLOWED.some((r) => r.test(path))) {
    return Response.json({ error: "path not allowed" }, { status: 400 });
  }
  const qs = new URLSearchParams();
  for (const k of ["page_size", "page_token"]) {
    const v = u.searchParams.get(k);
    if (v) qs.set(k, v);
  }
  const url = BASE + path + (qs.size ? `?${qs}` : "");
  const started = Date.now();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    const body = await res.text();
    return Response.json({
      upstream: url,
      status: res.status,
      ms: Date.now() - started,
      headers: Object.fromEntries(
        [...res.headers].filter(([k]) =>
          /^(content-type|cache-control|x-ratelimit|retry-after|date)/i.test(k)
        )
      ),
      body,
    });
  } catch (e) {
    return Response.json({ upstream: url, error: String(e) }, { status: 502 });
  }
};
