import type {
  FrontclawPlugin,
  Permissions,
  PluginContext,
  PluginError,
  PluginInterceptResult,
  RPCHookRequest,
  RPCMessage,
  SandboxedLogger,
} from "../types/index.js";
import {
  createErrorResponse,
  createSuccessResponse,
  createSysCallRequest,
} from "../types/rpc.js";
import readline from "node:readline";

type InitMessage = {
  id: string;
  type: "INIT";
  config: Record<string, unknown>;
  permissions: Permissions;
  pluginId: string;
};

const pendingSysCalls = new Map<
  string,
  { resolve: (value: unknown) => void; reject: (error: Error) => void }
>();

let pluginConfig: Record<string, unknown> = {};
let pluginPermissions: Permissions = {
  state: { enabled: true, read: true, write: true },
  log: { enabled: true, levels: ["debug", "info", "warn", "error"] },
};
let pluginId = "";
let pluginInstance: FrontclawPlugin | null = null;
let hasLoaded = false;

function writeLine(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function dispatchSysCall<T = unknown>(
  method: string,
  payload: unknown,
): Promise<T> {
  const request = createSysCallRequest(method, payload);
  writeLine(request);

  return new Promise((resolve, reject) => {
    pendingSysCalls.set(request.id, {
      resolve: resolve as (value: unknown) => void,
      reject,
    });

    setTimeout(() => {
      const pending = pendingSysCalls.get(request.id);
      if (!pending) return;
      pendingSysCalls.delete(request.id);
      reject(new Error(`System call ${method} timed out`));
    }, 30_000);
  });
}

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

function createSandboxedLogger(): SandboxedLogger {
  const log = (
    level: "debug" | "info" | "warn" | "error",
    message: string,
    meta?: Record<string, unknown>,
  ) => {
    dispatchSysCall("log", { level, message, meta, pluginId }).catch(() => {
      // Ignore logging failures.
    });
  };

  return {
    debug: (message, meta) => log("debug", message, meta),
    info: (message, meta) => log("info", message, meta),
    warn: (message, meta) => log("warn", message, meta),
    error: (message, meta) => log("error", message, meta),
  };
}

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
    async list(
      prefix?: string,
      options?: { limit?: number },
    ): Promise<string[]> {
      return dispatchSysCall("memory.list", {
        prefix: normalizePrefix(prefix),
        options,
      });
    },
  };
}

function createSandboxedState() {
  return {
    async get<T = unknown>(key: string): Promise<T | null> {
      return dispatchSysCall("state.get", { key });
    },
    async set<T = unknown>(key: string, value: T): Promise<void> {
      await dispatchSysCall("state.set", { key, value });
    },
    async delete(key: string): Promise<void> {
      await dispatchSysCall("state.delete", { key });
    },
    async list(prefix?: string): Promise<string[]> {
      return dispatchSysCall("state.list", { prefix });
    },
    async clear(): Promise<void> {
      await dispatchSysCall("state.clear", {});
    },
  };
}

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

function createSandboxedFS() {
  return {
    async readText(path: string): Promise<string> {
      return dispatchSysCall("fs.readText", { path });
    },
    async writeText(path: string, content: string): Promise<void> {
      await dispatchSysCall("fs.writeText", { path, content });
    },
    async list(path?: string): Promise<string[]> {
      return dispatchSysCall("fs.list", { path });
    },
  };
}

function createSandboxedLLM() {
  return {
    async chat(options: {
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
    }> {
      return dispatchSysCall("llm.chat", options);
    },
  };
}

function createContext(): PluginContext {
  return {
    config: pluginConfig,
    permissions: pluginPermissions,
    pluginId,
    fetch: createSandboxedFetch(),
    log: createSandboxedLogger(),
    memory: createSandboxedMemory(),
    state: createSandboxedState(),
    skills: createSandboxedSkills(),
    fs: createSandboxedFS(),
    llm: createSandboxedLLM(),
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

async function handleInit(msg: InitMessage): Promise<void> {
  try {
    pluginConfig = msg.config || {};
    pluginPermissions = msg.permissions || pluginPermissions;
    pluginId = msg.pluginId;

    if (pluginInstance?.onLoad && !hasLoaded) {
      await pluginInstance.onLoad(createContext());
      hasLoaded = true;
    }

    writeLine(createSuccessResponse(msg.id, { loaded: true }));
  } catch (error) {
    const err = error as Error;
    writeLine(createErrorResponse(msg.id, "INIT_FAILED", err.message, err.stack));
  }
}

async function handleHook(msg: RPCHookRequest): Promise<void> {
  if (!pluginInstance) {
    writeLine(createErrorResponse(msg.id, "NOT_LOADED", "Plugin not loaded"));
    return;
  }

  const hookName = msg.method as keyof FrontclawPlugin;
  const hook = pluginInstance[hookName];

  if (typeof hook !== "function") {
    writeLine(createSuccessResponse(msg.id, undefined));
    return;
  }

  try {
    const ctx = createContext();
    const args = toHookArgs(msg.method, msg.payload);
    const result = await (hook as Function).call(pluginInstance, ctx, ...args);
    writeLine(createSuccessResponse(msg.id, result));
  } catch (error) {
    const err = error as Error;
    writeLine(
      createErrorResponse(
        msg.id,
        (err as any).code || "HOOK_ERROR",
        err.message,
        err.stack,
      ),
    );
  }
}

function handleResponse(msg: RPCMessage): void {
  const pending = pendingSysCalls.get((msg as any).id);
  if (!pending) return;
  pendingSysCalls.delete((msg as any).id);

  if (msg.type === "ERROR") {
    pending.reject(new Error(msg.error.message));
  } else if (msg.type === "RESPONSE") {
    pending.resolve(msg.result);
  }
}

export function serveDockerPlugin(plugin: FrontclawPlugin): void {
  pluginInstance = plugin;
  writeLine({ type: "SANDBOX_READY" });

  const rl = readline.createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
  });

  rl.on("line", (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    let msg: RPCMessage | InitMessage;
    try {
      msg = JSON.parse(trimmed) as RPCMessage | InitMessage;
    } catch {
      return;
    }

    if ((msg as InitMessage).type === "INIT") {
      void handleInit(msg as InitMessage);
      return;
    }

    if (msg.type === "HOOK") {
      void handleHook(msg as RPCHookRequest);
      return;
    }

    if (msg.type === "RESPONSE" || msg.type === "ERROR") {
      handleResponse(msg);
    }
  });
}
