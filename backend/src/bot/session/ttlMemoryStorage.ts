import type { StorageAdapter } from "grammy";

type Entry<T> = {
  value: T;
  expiresAt: number;
};

/**
 * In-memory Grammy session store with TTL eviction.
 * Prevents unbounded RAM growth from inactive chat sessions.
 */
export class TtlMemorySessionStorage<T> implements StorageAdapter<T> {
  private readonly store = new Map<string, Entry<T>>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly cleanupTimer: NodeJS.Timeout;

  constructor(options?: { ttlMs?: number; maxEntries?: number; cleanupIntervalMs?: number }) {
    this.ttlMs = options?.ttlMs ?? 24 * 60 * 60 * 1000; // 24h
    this.maxEntries = options?.maxEntries ?? 5_000;
    const cleanupIntervalMs = options?.cleanupIntervalMs ?? 15 * 60 * 1000; // 15m

    this.cleanupTimer = setInterval(() => {
      this.purgeExpired();
    }, cleanupIntervalMs);
    // Do not keep the process alive solely for session cleanup.
    this.cleanupTimer.unref?.();
  }

  async read(key: string): Promise<T | undefined> {
    const entry = this.store.get(key);
    if (!entry) return undefined;

    if (entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return undefined;
    }

    // Sliding TTL on read so active users stay warm.
    entry.expiresAt = Date.now() + this.ttlMs;
    return entry.value;
  }

  async write(key: string, value: T): Promise<void> {
    if (this.store.size >= this.maxEntries && !this.store.has(key)) {
      this.purgeExpired();
      if (this.store.size >= this.maxEntries) {
        // Drop oldest by expiry if still over capacity.
        let oldestKey: string | undefined;
        let oldestExp = Number.POSITIVE_INFINITY;
        for (const [k, entry] of this.store) {
          if (entry.expiresAt < oldestExp) {
            oldestExp = entry.expiresAt;
            oldestKey = k;
          }
        }
        if (oldestKey) this.store.delete(oldestKey);
      }
    }

    this.store.set(key, {
      value,
      expiresAt: Date.now() + this.ttlMs,
    });
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  private purgeExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (entry.expiresAt <= now) {
        this.store.delete(key);
      }
    }
  }

  /** Call on shutdown to clear the cleanup interval. */
  stop(): void {
    clearInterval(this.cleanupTimer);
  }
}
