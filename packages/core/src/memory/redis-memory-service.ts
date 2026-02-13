/**
 * Redis-backed Memory Service
 * Stores JSON values by key and supports prefix listing via SCAN
 */

import { createClient, type RedisClientType } from "redis";
import type { MemoryService } from "./memory-service.js";

export interface RedisMemoryOptions {
  url?: string;
  client?: RedisClientType;
  namespace?: string;
}

export class RedisMemoryService implements MemoryService {
  private client: RedisClientType;
  private connected = false;
  private connectPromise: Promise<void> | null = null;
  private namespace?: string;

  constructor(options: RedisMemoryOptions = {}) {
    this.client =
      options.client ??
      createClient({
        url: options.url,
      });
    this.namespace = options.namespace;

    this.client.on("error", (err) => {
      console.error("[RedisMemoryService] Redis error:", err);
    });
  }

  private async ensureConnected(): Promise<void> {
    if (this.connected) return;
    if (!this.connectPromise) {
      this.connectPromise = this.client.connect().then(() => {
        this.connected = true;
      });
    }
    await this.connectPromise;
  }

  async get<T = unknown>(key: string): Promise<T | null> {
    await this.ensureConnected();
    const raw = await this.client.get(this.applyNamespace(key));
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return raw as unknown as T;
    }
  }

  async set<T = unknown>(
    key: string,
    value: T,
    options?: { ttlSeconds?: number },
  ): Promise<void> {
    await this.ensureConnected();
    const payload = JSON.stringify(value);
    if (options?.ttlSeconds && options.ttlSeconds > 0) {
      await this.client.set(this.applyNamespace(key), payload, {
        EX: options.ttlSeconds,
      });
    } else {
      await this.client.set(this.applyNamespace(key), payload);
    }
  }

  async delete(key: string): Promise<void> {
    await this.ensureConnected();
    await this.client.del(this.applyNamespace(key));
  }

  async list(prefix?: string, options?: { limit?: number }): Promise<string[]> {
    await this.ensureConnected();
    const effectivePrefix = prefix ?? "";
    const match = this.applyNamespace(`${effectivePrefix}*`);
    let cursor = "0";
    const keys: string[] = [];

    do {
      const result = await this.client.scan(cursor, {
        MATCH: match,
        COUNT: 200,
      });
      cursor = result.cursor;
      const mapped = result.keys.map((k) => this.stripNamespace(k));
      keys.push(...mapped);
      if (options?.limit && keys.length >= options.limit) {
        return keys.slice(0, options.limit);
      }
    } while (cursor !== "0");

    return keys;
  }

  async ttlSeconds(key: string): Promise<number | null> {
    await this.ensureConnected();
    const ttl = await this.client.ttl(this.applyNamespace(key));
    if (ttl < 0) return null;
    return ttl;
  }

  private applyNamespace(key: string): string {
    if (!this.namespace) return key;
    return `${this.namespace}:${key}`;
  }

  private stripNamespace(key: string): string {
    if (!this.namespace) return key;
    const prefix = `${this.namespace}:`;
    return key.startsWith(prefix) ? key.slice(prefix.length) : key;
  }
}
