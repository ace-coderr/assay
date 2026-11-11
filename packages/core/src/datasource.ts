/**
 * Where the published JSON is read from, and how to read it without getting a stale copy.
 *
 * raw.githubusercontent.com caches branch URLs, and on some network paths a branch URL keeps returning an old commit
 * for far longer than its max-age. A commit-SHA URL is immutable, so the data source first asks the GitHub API which
 * commit the `data` branch points at (one small CORS-enabled call, cached for a few minutes) and reads files by SHA.
 * If the API is unavailable or rate-limited it falls back to the branch URL, and every reading still carries its own
 * timestamp, so a stale copy is always visible as such.
 */
export const DEFAULT_REPO = "ace-coderr/assay";
export const DEFAULT_BRANCH = "data";
export const RAW_HOST = "https://raw.githubusercontent.com";

export interface DataSourceOptions {
  repo?: string;
  branch?: string;
  fetchFn?: typeof fetch;
  /** How long a resolved commit is trusted before asking the API again. */
  ttlMs?: number;
  /** Fixed root URL (no SHA resolution), e.g. for local testing. */
  fixedRoot?: string;
  now?: () => number;
}

export class DataSource {
  private readonly repo: string;
  private readonly branch: string;
  private readonly fetchFn: typeof fetch;
  private readonly ttlMs: number;
  private readonly fixedRoot?: string;
  private readonly now: () => number;
  private cached: { sha: string; at: number } | null = null;

  constructor(o: DataSourceOptions = {}) {
    this.repo = o.repo ?? DEFAULT_REPO;
    this.branch = o.branch ?? DEFAULT_BRANCH;
    this.fetchFn = o.fetchFn ?? ((...a) => fetch(...a));
    this.ttlMs = o.ttlMs ?? 5 * 60_000;
    this.fixedRoot = o.fixedRoot?.replace(/\/$/, "");
    this.now = o.now ?? Date.now;
  }

  /** The branch URL: always valid, but may be an older copy on some network paths. */
  get branchRoot(): string {
    return this.fixedRoot ?? `${RAW_HOST}/${this.repo}/${this.branch}`;
  }

  /** Root URL to read files from: the immutable SHA URL when it can be resolved, else the branch URL. */
  async root(): Promise<string> {
    if (this.fixedRoot) return this.fixedRoot;
    if (this.cached && this.now() - this.cached.at < this.ttlMs) return `${RAW_HOST}/${this.repo}/${this.cached.sha}`;
    try {
      const res = await this.fetchFn(`https://api.github.com/repos/${this.repo}/git/ref/heads/${this.branch}`, {
        headers: { accept: "application/vnd.github+json" },
        signal: AbortSignal.timeout(8_000),
      });
      if (res.ok) {
        const sha = ((await res.json()) as { object?: { sha?: string } }).object?.sha;
        if (sha && /^[0-9a-f]{40}$/.test(sha)) {
          this.cached = { sha, at: this.now() };
          return `${RAW_HOST}/${this.repo}/${sha}`;
        }
      }
    } catch {
      /* fall through to the branch URL */
    }
    return this.branchRoot;
  }

  invalidate(): void {
    this.cached = null;
  }

  /** Full URL of a published file. */
  async url(file: string): Promise<string> {
    return `${await this.root()}/${file}`;
  }

  /**
   * Fetch a published file. If a SHA-pinned read fails (for example the commit was replaced by a newer force-push),
   * drop the cached commit and retry once against the freshly resolved commit, then the branch URL.
   */
  async fetch(file: string, init?: RequestInit): Promise<Response> {
    const first = await this.url(file);
    try {
      const res = await this.fetchFn(first, init);
      if (res.ok || this.fixedRoot) return res;
    } catch (e) {
      if (this.fixedRoot) throw e;
    }
    this.invalidate();
    const second = await this.url(file);
    if (second !== first) {
      try {
        const res = await this.fetchFn(second, init);
        if (res.ok) return res;
      } catch {
        /* fall back below */
      }
    }
    return this.fetchFn(`${this.branchRoot}/${file}`, init);
  }
}
