/**
 * Secure Memory Service
 * Encrypts and signs values before storing them in the underlying memory service.
 */

import crypto from "node:crypto";
import type { MemoryService } from "./memory-service.js";

export interface SecureMemoryOptions {
  encryptionKey: Buffer;
  signingKey?: Buffer;
}

export class SecureMemoryService implements MemoryService {
  private signingKey: Buffer;

  constructor(
    private readonly inner: MemoryService,
    private readonly options: SecureMemoryOptions,
  ) {
    if (options.encryptionKey.length !== 32) {
      throw new Error("encryptionKey must be 32 bytes (AES-256-GCM)");
    }
    this.signingKey = options.signingKey ?? options.encryptionKey;
  }

  async get<T = unknown>(key: string): Promise<T | null> {
    const raw = await this.inner.get<string>(key);
    if (!raw) return null;
    return this.decrypt<T>(raw);
  }

  async set<T = unknown>(
    key: string,
    value: T,
    options?: { ttlSeconds?: number },
  ): Promise<void> {
    const encrypted = this.encrypt(value);
    await this.inner.set(key, encrypted, options);
  }

  async delete(key: string): Promise<void> {
    await this.inner.delete(key);
  }

  async list(prefix?: string, options?: { limit?: number }): Promise<string[]> {
    return this.inner.list(prefix, options);
  }

  async ttlSeconds(key: string): Promise<number | null> {
    if (!this.inner.ttlSeconds) return null;
    return this.inner.ttlSeconds(key);
  }

  private encrypt(value: unknown): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(
      "aes-256-gcm",
      this.options.encryptionKey,
      iv,
    );
    const plaintext = Buffer.from(JSON.stringify(value), "utf8");
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();

    const hmac = crypto
      .createHmac("sha256", this.signingKey)
      .update(iv)
      .update(tag)
      .update(ciphertext)
      .digest("base64");

    return JSON.stringify({
      v: 1,
      iv: iv.toString("base64"),
      tag: tag.toString("base64"),
      ct: ciphertext.toString("base64"),
      hmac,
    });
  }

  private decrypt<T>(payload: string): T {
    const data = JSON.parse(payload) as {
      v: number;
      iv: string;
      tag: string;
      ct: string;
      hmac: string;
    };

    const iv = Buffer.from(data.iv, "base64");
    const tag = Buffer.from(data.tag, "base64");
    const ciphertext = Buffer.from(data.ct, "base64");

    const expected = crypto
      .createHmac("sha256", this.signingKey)
      .update(iv)
      .update(tag)
      .update(ciphertext)
      .digest("base64");

    if (expected !== data.hmac) {
      throw new Error("Memory signature mismatch");
    }

    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      this.options.encryptionKey,
      iv,
    );
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    return JSON.parse(plaintext.toString("utf8")) as T;
  }
}
