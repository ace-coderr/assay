import fs from "node:fs";
import path from "node:path";

/** Key-value state the refresh reads and writes. Backed by JSON files that live on the `data` branch. */
export interface Store {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown): Promise<void>;
}

export const bigintReplacer = (_k: string, v: unknown) => (typeof v === "bigint" ? v.toString() : v);

/** A key becomes a file name: "history:AAPLc" -> "history_AAPLc.json". Keys are our own, never user input. */
export const keyToFile = (key: string) => key.replace(/[^A-Za-z0-9._-]/g, "_") + ".json";

/** In-memory store. Used directly in tests, and as the base of FileStore. */
export class MemoryStore implements Store {
  protected data = new Map<string, string>();
  async get<T>(key: string): Promise<T | null> {
    const v = this.data.get(key);
    return v ? (JSON.parse(v) as T) : null;
  }
  async set(key: string, value: unknown): Promise<void> {
    this.data.set(key, JSON.stringify(value, bigintReplacer));
  }
  keys(): string[] {
    return [...this.data.keys()];
  }
}

/**
 * Loads state from a directory of JSON files written by the previous run, so history rolls forward, and writes
 * everything back with `save`. A missing or empty directory is a first run, not an error.
 */
export class FileStore extends MemoryStore {
  static load(dir: string): FileStore {
    const s = new FileStore();
    if (!fs.existsSync(dir)) return s;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith(".json")) continue;
      // The file may hold a key that was sanitised; the original key is stored alongside the value.
      const raw = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as { key: string; value: unknown };
      s.data.set(raw.key, JSON.stringify(raw.value));
    }
    return s;
  }
  save(dir: string): void {
    fs.mkdirSync(dir, { recursive: true });
    for (const [key, value] of this.data) {
      fs.writeFileSync(path.join(dir, keyToFile(key)), JSON.stringify({ key, value: JSON.parse(value) }));
    }
  }
}
