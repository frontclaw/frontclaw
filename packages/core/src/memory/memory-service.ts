/**
 * In-memory Memory Service
 * Namespaced key-value store with prefix listing
 */

export interface MemoryService {
  get<T = unknown>(key: string): Promise<T | null>;
  set<T = unknown>(
    key: string,
    value: T,
    options?: { ttlSeconds?: number },
  ): Promise<void>;
  delete(key: string): Promise<void>;
  list(prefix?: string, options?: { limit?: number }): Promise<string[]>;
  ttlSeconds?(key: string): Promise<number | null>;
}

export class InMemoryService implements MemoryService {
  private store = new Map<string, { value: unknown; expiresAt?: number }>();

  async get<T = unknown>(key: string): Promise<T | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.value as T;
  }

  async set<T = unknown>(
    key: string,
    value: T,
    options?: { ttlSeconds?: number },
  ): Promise<void> {
    const expiresAt =
      options?.ttlSeconds && options.ttlSeconds > 0
        ? Date.now() + options.ttlSeconds * 1000
        : undefined;
    this.store.set(key, { value, expiresAt });
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async list(prefix?: string, options?: { limit?: number }): Promise<string[]> {
    const now = Date.now();
    const keys = [];
    for (const [key, entry] of this.store.entries()) {
      if (entry.expiresAt && now > entry.expiresAt) {
        this.store.delete(key);
        continue;
      }
      if (prefix && !key.startsWith(prefix)) continue;
      keys.push(key);
      if (options?.limit && keys.length >= options.limit) break;
    }
    return keys;
  }

  async ttlSeconds(key: string): Promise<number | null> {
    const entry = this.store.get(key);
    if (!entry?.expiresAt) return null;
    const remainingMs = entry.expiresAt - Date.now();
    return remainingMs > 0 ? Math.ceil(remainingMs / 1000) : 0;
  }
}
