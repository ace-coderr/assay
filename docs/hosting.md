# Hosting: moving from Netlify to GitHub (free only)

Assay ran on Netlify (functions, a scheduled function, Blobs, a remote MCP endpoint). Netlify's free credits are used
up, so builds are skipped and the live site runs a stale engine. Everything now moves to GitHub, at no cost:

- **GitHub Pages** serves the static React site at `https://ace-coderr.github.io/assay/`.
- **GitHub Actions** runs the readings pipeline on a schedule and publishes JSON to an orphan `data` branch.
- **The browser** reads that JSON and talks to the public Base RPCs directly.
- **MCP** is a local stdio server that agents run themselves. There is no hosted MCP endpoint.

The repository is public, which is what makes Actions minutes and Pages free.

## What depended on Netlify, and where it goes

| Netlify piece | What it did | Static-host replacement |
| --- | --- | --- |
| Scheduled function `refresh` (every 5 min) | Fetched the Tokenized Stocks API and chain data, built readings, stored history | GitHub Actions workflow on cron (every 10 min) + manual `workflow_dispatch`. Same engine code (`apps/pipeline`). |
| Netlify Blobs store | Held `latest`, per-token history, events, corporate actions, multipliers, cursors | JSON files on the `data` branch. Each run reads the previous files first, so history rolls forward, then force-pushes one orphan commit (no repo bloat). |
| `/api/board`, `/api/status`, `/api/token/:s`, `/api/history/:s`, `/api/actions`, `/api/events` | Read API | Static files `board.json`, `status.json`, `token/<SYMBOL>.json`, `history/<SYMBOL>.json`, `actions.json`, `events.json` on the `data` branch, served by `raw.githubusercontent.com`. |
| `/api/feed.xml` | RSS of state changes | `feed.xml` on the `data` branch. |
| `/api/probe`, `/api/check` | Price-impact quote and verdict | Computed in the browser by the shared engine (`packages/core`) from the published pool data, with an optional live re-read of the pool over a public RPC. |
| `/api/actions/:uuid` | Proxy to the issuer's corporate-action record | The Coinbase API sends **no CORS headers**, so the browser cannot call it. The pipeline fetches each record and embeds it in `actions.json`. |
| `/mcp` (remote MCP, Netlify function) | Hosted MCP for agents | **Not available.** Replaced by a local stdio server (`packages/mcp`) that an agent runs on its own machine. No hosted URL exists or is promised. |
| Rate limiting (edge rules + in-memory) | Protected the functions | Not needed for static files (GitHub's CDN serves them). The only rate limits left are the public RPCs' own, handled with fallback and caching in the client. |
| Webhook registration (`POST /api/webhooks`) | Stored subscriber URLs and POSTed state changes | **Removed.** A static site has nowhere to store subscriber URLs safely, and storing them in the repo would need secrets. Alerts are browser notifications (while the page is open) and the RSS feed. |
| `netlify.toml` (build, headers) | Build command, security headers | Replaced by `.github/workflows/pages.yml`. Static hosting cannot set response headers, so `X-Frame-Options` and similar are not available; a CSP and referrer policy are set through `<meta>` tags. |
| `public/_redirects` (SPA fallback) | Deep links like `/app/token/CRCLc` | Hash routing (`#/app/token/CRCLc`), which works on any static host without server rules. |
| Cold-start refresh inside the API | Filled the store on first request | Not needed: the workflow publishes data before the site reads it. |
| Footer "live block" | Read `/api/status` | Reads `status.json`. |

## Behaviour changes, stated plainly

- **Cadence.** Readings are produced every 10 minutes by schedule, not 5. GitHub's cron is best-effort and can lag by
  many minutes under load, so the UI always shows each reading's real age, and staleness thresholds are set for
  this cadence (a board older than 30 minutes is flagged; `check_before_trade` treats readings older than 45 minutes
  as unknown).
- **Data freshness, and a stale-cache trap.** `raw.githubusercontent.com` sends `max-age=300`, but on some network
  paths a *branch* URL kept returning a reading that was over an hour old while the newest commit was correct (seen
  from the in-app browser used to test this site; the same URL from a terminal was correct). So neither the site nor
  the MCP server read the branch URL directly: they first ask `api.github.com` which commit the `data` branch points
  at (one small CORS-enabled call, cached for 5 minutes) and read files from the immutable commit-SHA URL. If the API is
  rate limited (60 calls per hour per IP without a token) they fall back to the branch URL, and the displayed reading
  age makes any stale copy visible. jsDelivr was rejected because it caches branch files for up to 12 hours.
- **Scheduled workflows pause.** GitHub disables scheduled workflows in a public repository after 60 days without
  repository activity. If that happens, re-enable it in the Actions tab (a manual run also restarts it).
- **No hosted MCP.** Agents must run the local server (see the Agent page).
- **No webhooks.** RSS and in-browser alerts only.
- **Secrets.** The pipeline uses only public APIs and needs no secrets. The deployer private key for the Base Sepolia
  attestations is never added to GitHub Actions or any secret; attestation signing stays local-only.

## Retiring the old Netlify site

The previous site (`assay-onbase.netlify.app`) still serves the old engine and will keep doing so until it is deleted.
Netlify has no "unpublish" switch: deleting the project is what takes it down. In the Netlify dashboard:

1. Sign in at https://app.netlify.com and open the project **assay-onbase**.
2. In the left sidebar choose **Project configuration**, then **General**.
3. Scroll to the bottom, to **Danger zone**, and click **Delete this project**.
4. Type the project name (`assay-onbase`) when asked and confirm.

Deleting is permanent: the old URL stops working and the Blobs data is erased. That is what we want, because the data
now lives on the `data` branch. If you prefer the command line (you are logged in as the owner):

```bash
npx netlify-cli sites:delete 4ac4886c-5d9f-4d6f-916e-38b6104641cf
```

Nothing in this repository depends on the Netlify project any more. The Netlify GitHub app link on the repository
settings page can also be removed (GitHub, Settings, Applications), but it is harmless once the project is deleted.

## Cost

Free. Public-repository Actions minutes, GitHub Pages, and `raw.githubusercontent.com` cost nothing, and the public
RPCs are free. Netlify, Vercel, Railway and Cloudflare are not used.
