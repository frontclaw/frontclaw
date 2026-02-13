/**
 * Plugin Context Types
 * The sandboxed context passed to plugin hooks
 */

import type { Permissions } from "./permissions";

/** Database query result */
export interface DBQueryResult<T = unknown> {
  rows: T[];
  rowCount: number;
}

/** Sandboxed database interface */
export interface SandboxedDB {
  /** Execute a read query */
  query<T = unknown>(
    sql: string,
    params?: unknown[],
  ): Promise<DBQueryResult<T>>;

  /** Get items from a table (if permitted) */
  getItems<T = unknown>(
    table: string,
    options?: {
      where?: Record<string, unknown>;
      limit?: number;
      offset?: number;
    },
  ): Promise<T[]>;

  /** Get a single item by ID */
  getItem<T = unknown>(table: string, id: string): Promise<T | null>;
}

/** Sandboxed fetch interface */
export interface SandboxedFetch {
  (url: string, init?: RequestInit): Promise<Response>;
}

/** Sandboxed logger interface */
export interface SandboxedLogger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

/** Sandboxed memory interface */
export interface SandboxedMemory {
  get<T = unknown>(key: string): Promise<T | null>;
  set<T = unknown>(
    key: string,
    value: T,
    options?: { ttlSeconds?: number },
  ): Promise<void>;
  delete(key: string): Promise<void>;
  list(prefix?: string, options?: { limit?: number }): Promise<string[]>;
}

/** Sandboxed skills interface */
export interface SandboxedSkills {
  invoke<T = unknown>(
    skillName: string,
    args: Record<string, unknown>,
  ): Promise<T>;
}

/** Socket client interface passed to plugins */
export interface SocketClient {
  id: string;
  send(event: string, data: unknown): Promise<void>;
  close(code?: number, reason?: string): Promise<void>;
}

/** The sandboxed context provided to plugin hooks */
export interface PluginContext {
  /** Plugin's configuration (from manifest + user overrides) */
  readonly config: Record<string, unknown>;

  /** Plugin's declared permissions */
  readonly permissions: Permissions;

  /** Plugin ID */
  readonly pluginId: string;

  /** Sandboxed database access */
  readonly db: SandboxedDB;

  /** Sandboxed fetch (respects network permissions) */
  readonly fetch: SandboxedFetch;

  /** Sandboxed logger */
  readonly log: SandboxedLogger;

  /** Sandboxed memory */
  readonly memory: SandboxedMemory;

  /** Sandboxed skills */
  readonly skills: SandboxedSkills;

  /** Create a security error that stops the pipeline */
  error(code: string, message: string): PluginError;

  /** Request to skip remaining plugins and return immediately */
  intercept<T>(result: T): PluginInterceptResult<T>;
}

/** Error thrown by plugins to stop the pipeline */
export class PluginError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly pluginId?: string,
  ) {
    super(message);
    this.name = "PluginError";
  }
}

/** Result indicating the plugin wants to intercept and return early */
export interface PluginInterceptResult<T> {
  __intercept: true;
  result: T;
}

/** Check if a value is an intercept result */
export function isInterceptResult(
  value: unknown,
): value is PluginInterceptResult<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    "__intercept" in value &&
    (value as PluginInterceptResult<unknown>).__intercept === true
  );
}
