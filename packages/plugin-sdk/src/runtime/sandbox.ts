/**
 * Plugin Runtime Sandbox
 * This file runs inside the Bun.Worker and provides the sandboxed context
 */

import type {
  RPCMessage,
  RPCHookRequest,
  RPCResponse,
  RPCSysCallRequest,
  PluginContext,
  FrontclawPlugin,
  Permissions,
  PluginError,
  PluginInterceptResult,
  SandboxedDB,
  SandboxedLogger,
} from "../types/index.js";
import {
  createSuccessResponse,
  createErrorResponse,
  createSysCallRequest,
} from "../types/rpc.js";

/** Pending system call promises */
const pendingSysCalls = new Map<
  string,
  { resolve: (value: unknown) => void; reject: (error: Error) => void }
>();

/** The loaded plugin instance */
let plugin: FrontclawPlugin | null = null;

/** Plugin configuration */
let pluginConfig: Record<string, unknown> = {};

/** Plugin permissions */
let pluginPermissions: Permissions = {
  log: { enabled: true, levels: ["debug", "info", "warn", "error"] },
};

/** Plugin ID */
let pluginId = "";

/**
 * Dispatch a system call to the Core and wait for response
 */
function dispatchSysCall<T = unknown>(
  method: string,
  payload: unknown,
): Promise<T> {
  const request = createSysCallRequest(method, payload);

  return new Promise((resolve, reject) => {
    pendingSysCalls.set(request.id, {
      resolve: resolve as (value: unknown) => void,
      reject,
    });

    // Send to Core
    postMessage(request);

    // Timeout after 30 seconds
    setTimeout(() => {
      if (pendingSysCalls.has(request.id)) {
        pendingSysCalls.delete(request.id);
        reject(new Error(`System call ${method} timed out`));
      }
    }, 30000);
  });
}

/**
 * Create the sandboxed database interface
 */
function createSandboxedDB(): SandboxedDB {
  return {
    async query(sql, params) {
      return dispatchSysCall("db.query", { sql, params });
    },
    async getItems(table, options) {
      return dispatchSysCall("db.getItems", { table, ...options });
    },
    async getItem(table, id) {
      return dispatchSysCall("db.getItem", { table, id });
    },
  };
}

/**
 * Create the sandboxed fetch interface
 */
function createSandboxedFetch(): (
  url: string,
  init?: RequestInit,
) => Promise<Response> {
  return async (url: string, init?: RequestInit) => {
    const result = await dispatchSysCall<{
      status: number;
      statusText: string;
      headers: Record<string, string>;
      body: string;
    }>("network.fetch", {
      url,
      method: init?.method || "GET",
      headers: init?.headers,
      body: init?.body,
    });

    return new Response(result.body, {
      status: result.status,
      statusText: result.statusText,
      headers: result.headers,
    });
  };
}

/**
 * Create the sandboxed logger
 */
function createSandboxedLogger(): SandboxedLogger {
  const log = (
    level: "debug" | "info" | "warn" | "error",
    message: string,
    meta?: Record<string, unknown>,
  ) => {
    // Fire and forget - don't await
    dispatchSysCall("log", { level, message, meta, pluginId }).catch(() => {
      // Ignore logging errors
    });
  };

  return {
    debug: (message, meta) => log("debug", message, meta),
    info: (message, meta) => log("info", message, meta),
    warn: (message, meta) => log("warn", message, meta),
    error: (message, meta) => log("error", message, meta),
  };
}

/**
 * Create the sandboxed memory interface
 */
function createSandboxedMemory() {
  const normalizeKey = (key: string) => {
    if (key.includes(":")) return key;
    return `${pluginId}:${key}`;
  };
  const normalizePrefix = (prefix?: string) => {
    if (!prefix) return `${pluginId}:`;
    if (prefix.includes(":")) return prefix;
    return `${pluginId}:${prefix}`;
  };
  return {
    async get<T = unknown>(key: string): Promise<T | null> {
      return dispatchSysCall("memory.get", { key: normalizeKey(key) });
    },
    async set<T = unknown>(
      key: string,
      value: T,
      options?: { ttlSeconds?: number },
    ): Promise<void> {
      await dispatchSysCall("memory.set", {
        key: normalizeKey(key),
        value,
        options,
      });
    },
    async delete(key: string): Promise<void> {
      await dispatchSysCall("memory.delete", { key: normalizeKey(key) });
    },
    async list(prefix?: string, options?: { limit?: number }): Promise<string[]> {
      return dispatchSysCall("memory.list", {
        prefix: normalizePrefix(prefix),
        options,
      });
    },
  };
}

/**
 * Create the sandboxed skills interface
 */
function createSandboxedSkills() {
  const normalizeSkillName = (skillName: string) => {
    if (skillName.includes("__")) return skillName;
    return `${pluginId}__${skillName}`;
  };
  return {
    async invoke<T = unknown>(
      skillName: string,
      args: Record<string, unknown>,
    ): Promise<T> {
      const result = await dispatchSysCall("skills.invoke", {
        skillName: normalizeSkillName(skillName),
        args,
      });
      return result as T;
    },
  };
}

/**
 * Create the plugin context
 */
function createContext(): PluginContext {
  return {
    config: pluginConfig,
    permissions: pluginPermissions,
    pluginId,
    db: createSandboxedDB(),
    fetch: createSandboxedFetch(),
    log: createSandboxedLogger(),
    memory: createSandboxedMemory(),
    skills: createSandboxedSkills(),
    error(code: string, message: string): PluginError {
      const err = new Error(message) as PluginError;
      err.name = "PluginError";
      (err as any).code = code;
      (err as any).pluginId = pluginId;
      return err as PluginError;
    },
    intercept<T>(result: T): PluginInterceptResult<T> {
      return { __intercept: true, result };
    },
  };
}

/**
 * Handle incoming messages from the Core
 */
async function handleMessage(event: MessageEvent<RPCMessage>) {
  const msg = event.data;

  // Handle responses to our system calls
  if (msg.type === "RESPONSE" || msg.type === "ERROR") {
    const pending = pendingSysCalls.get(msg.id);
    if (pending) {
      pendingSysCalls.delete(msg.id);
      if (msg.type === "ERROR") {
        pending.reject(new Error(msg.error.message));
      } else {
        pending.resolve(msg.result);
      }
    }
    return;
  }

  // Handle hook calls from Core
  if (msg.type === "HOOK") {
    const hookRequest = msg as RPCHookRequest;
    await handleHookCall(hookRequest);
    return;
  }

  // Handle initialization
  if ((msg as any).type === "INIT") {
    await handleInit(msg as any);
    return;
  }
}

/**
 * Handle plugin initialization
 */
async function handleInit(msg: {
  id: string;
  type: "INIT";
  entryPath: string;
  config: Record<string, unknown>;
  permissions: Permissions;
  pluginId: string;
}) {
  try {
    pluginConfig = msg.config;
    pluginPermissions = msg.permissions;
    pluginId = msg.pluginId;

    // Dynamically import the plugin
    const module = await import(msg.entryPath);
    plugin = module.default || module;

    // Call onLoad if present
    if (plugin?.onLoad) {
      await plugin.onLoad(createContext());
    }

    postMessage(createSuccessResponse(msg.id, { loaded: true }));
  } catch (error) {
    const err = error as Error;
    postMessage(
      createErrorResponse(msg.id, "INIT_FAILED", err.message, err.stack),
    );
  }
}

/**
 * Handle a hook call from the Core
 */
async function handleHookCall(request: RPCHookRequest) {
  if (!plugin) {
    postMessage(
      createErrorResponse(request.id, "NOT_LOADED", "Plugin not loaded"),
    );
    return;
  }

  const hookName = request.method as keyof FrontclawPlugin;
  const hook = plugin[hookName];

  if (typeof hook !== "function") {
    // Hook not implemented - return undefined to signal skip
    postMessage(createSuccessResponse(request.id, undefined));
    return;
  }

  try {
    const ctx = createContext();
    const args = toHookArgs(request.method, request.payload);
    const result = await (hook as Function).call(plugin, ctx, ...args);
    postMessage(createSuccessResponse(request.id, result));
  } catch (error) {
    const err = error as Error;
    const code = (err as any).code || "HOOK_ERROR";
    postMessage(createErrorResponse(request.id, code, err.message, err.stack));
  }
}

function toHookArgs(method: string, payload: unknown): unknown[] {
  switch (method) {
    case "executeTool": {
      const value = payload as { toolName?: unknown; args?: unknown };
      return [value.toolName, value.args];
    }
    case "executeSkill": {
      const value = payload as { skillName?: unknown; args?: unknown };
      return [value.skillName, value.args];
    }
    case "onSocketMessage": {
      const value = payload as {
        client?: unknown;
        event?: unknown;
        data?: unknown;
      };
      return [value.client, value.event, value.data];
    }
    default:
      return [payload];
  }
}

// Set up message handler
self.onmessage = handleMessage;

// Signal that the sandbox is ready
postMessage({ type: "SANDBOX_READY" });
