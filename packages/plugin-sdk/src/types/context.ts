/**
 * Plugin Context Types
 * The sandboxed context passed to plugin hooks
 */

import type { Permissions } from "./permissions";

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

/** Sandboxed plugin-local state interface */
export interface SandboxedState {
  get<T = unknown>(key: string): Promise<T | null>;
  set<T = unknown>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  list(prefix?: string): Promise<string[]>;
  clear(): Promise<void>;
}

/** Sandboxed skills interface */
export interface SandboxedSkills {
  invoke<T = unknown>(
    skillName: string,
    args: Record<string, unknown>,
  ): Promise<T>;
}

/** Sandboxed filesystem interface (plugin-local paths only) */
export interface SandboxedFS {
  readText(path: string): Promise<string>;
  writeText(path: string, content: string): Promise<void>;
  list(path?: string): Promise<string[]>;
}

/** Sandboxed LLM interface */
export interface SandboxedLLM {
  chat(options: {
    messages: Array<{
      role: "system" | "user" | "assistant";
      content: string;
    }>;
    systemPrompt?: string;
    maxTokens?: number;
    temperature?: number;
    model?: string;
    provider?: string;
  }): Promise<{
    content: string;
    usage: {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
    };
  }>;
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

  /** Sandboxed fetch (respects network permissions) */
  readonly fetch: SandboxedFetch;

  /** Sandboxed logger */
  readonly log: SandboxedLogger;

  /** Sandboxed memory */
  readonly memory: SandboxedMemory;

  /** Sandboxed plugin-local state */
  readonly state: SandboxedState;

  /** Sandboxed skills */
  readonly skills: SandboxedSkills;

  /** Sandboxed filesystem access */
  readonly fs: SandboxedFS;

  /** Sandboxed LLM access */
  readonly llm: SandboxedLLM;

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
