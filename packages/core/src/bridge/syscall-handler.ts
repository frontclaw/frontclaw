/**
 * System Call Handler
 * Processes system calls from plugins with permission checking
 */

import type { LoadedPluginManifest } from "@workspace/plugin-sdk";
import { PermissionGuard, PermissionDeniedError } from "./permission-guard.js";
import type {
  SysCallDependencies,
  SysCallOrchestrator,
} from "./types.js";
import fs from "node:fs/promises";
import path from "node:path";

const SYSCALL_WINDOW_MS = 60_000;
const MAX_SYSCALLS_PER_WINDOW = 300;

type PluginQuotaState = {
  count: number;
  resetAt: number;
};

const pluginQuotaState = new Map<string, PluginQuotaState>();

class SysCallRateLimitError extends Error {
  code = "SYSCALL_RATE_LIMITED";
  constructor(pluginId: string, limit: number) {
    super(
      `Plugin '${pluginId}' exceeded the system call limit (${limit}/minute)`,
    );
    this.name = "SysCallRateLimitError";
  }
}

function enforceSysCallRateLimit(pluginId: string): void {
  const now = Date.now();
  const currentState = pluginQuotaState.get(pluginId);

  if (!currentState || now >= currentState.resetAt) {
    pluginQuotaState.set(pluginId, {
      count: 1,
      resetAt: now + SYSCALL_WINDOW_MS,
    });
    return;
  }

  if (currentState.count >= MAX_SYSCALLS_PER_WINDOW) {
    throw new SysCallRateLimitError(pluginId, MAX_SYSCALLS_PER_WINDOW);
  }

  currentState.count += 1;
}

function normalizeStateKey(key: string): string {
  const normalized = key.trim().replaceAll("\\", "/");
  if (!normalized) {
    throw new Error("State key cannot be empty");
  }
  if (normalized.includes("..")) {
    throw new Error("State key cannot contain '..'");
  }
  if (normalized.length > 200) {
    throw new Error("State key exceeds maximum length");
  }
  return normalized;
}

function toStateStorageKey(pluginId: string, key: string): string {
  return `state:${pluginId}:${key}`;
}

function pluginStatePrefix(pluginId: string): string {
  return `state:${pluginId}:`;
}

function resolvePluginRelativePath(
  manifest: LoadedPluginManifest,
  inputPath: string,
): { absolutePath: string; relativePath: string } {
  const normalizedInput = inputPath.trim();
  if (!normalizedInput) {
    throw new PermissionDeniedError(
      manifest.id,
      "fs.path",
      "access empty path",
    );
  }

  const pluginRoot = path.resolve(manifest.pluginPath);
  const resolvedPath = path.resolve(pluginRoot, normalizedInput);
  const relativePath = path.relative(pluginRoot, resolvedPath);

  const isInsidePluginRoot =
    relativePath === "" ||
    (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));

  if (!isInsidePluginRoot) {
    throw new PermissionDeniedError(
      manifest.id,
      "fs.path",
      `access path outside plugin root '${inputPath}'`,
    );
  }

  const normalizedRelativePath = relativePath
    .replaceAll("\\", "/")
    .replace(/^\.\/+/, "");

  return {
    absolutePath: resolvedPath,
    relativePath: normalizedRelativePath || ".",
  };
}

function toSysCallDebugMeta(
  method: string,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  if (method === "network.fetch") {
    return {
      url: payload.url,
      method: payload.method || "GET",
    };
  }
  if (method === "skills.invoke") {
    return {
      skillName: payload.skillName,
    };
  }
  if (method === "llm.chat") {
    const messages = Array.isArray(payload.messages)
      ? payload.messages.length
      : undefined;
    return {
      model: payload.model,
      provider: payload.provider,
      maxTokens: payload.maxTokens,
      messages,
    };
  }
  if (
    method === "fs.readText" ||
    method === "fs.writeText" ||
    method === "fs.list" ||
    method === "state.get" ||
    method === "state.set" ||
    method === "state.delete" ||
    method === "state.list" ||
    method === "memory.get" ||
    method === "memory.set" ||
    method === "memory.delete" ||
    method === "memory.list" ||
    method === "memory.ttl"
  ) {
    return {
      key: payload.key,
      path: payload.path,
      prefix: payload.prefix,
    };
  }
  return {};
}

/**
 * Create a system call handler with dependencies
 */
export function createSysCallHandler(
  deps: SysCallDependencies,
  orchestrator?: SysCallOrchestrator,
) {
  return async function handleSysCall(
    method: string,
    payload: unknown,
    manifest: LoadedPluginManifest,
  ): Promise<unknown> {
    enforceSysCallRateLimit(manifest.id);

    const guard = new PermissionGuard(manifest);
    const data = payload as Record<string, unknown>;
    deps.logger.debug(`[${manifest.id}] syscall ${method}`, {
      method,
      ...toSysCallDebugMeta(method, data),
    });

    if (method === "state.get") {
      const { key } = data as { key: string };
      guard.checkStateRead();
      if (!orchestrator) throw new Error("State service not available");
      const normalized = normalizeStateKey(key);
      return orchestrator.memoryGet(toStateStorageKey(manifest.id, normalized));
    }

    if (method === "state.set") {
      const { key, value } = data as { key: string; value: unknown };
      guard.checkStateWrite();
      if (!orchestrator) throw new Error("State service not available");
      const normalized = normalizeStateKey(key);
      await orchestrator.memorySet(
        toStateStorageKey(manifest.id, normalized),
        value,
      );
      return undefined;
    }

    if (method === "state.delete") {
      const { key } = data as { key: string };
      guard.checkStateWrite();
      if (!orchestrator) throw new Error("State service not available");
      const normalized = normalizeStateKey(key);
      await orchestrator.memoryDelete(toStateStorageKey(manifest.id, normalized));
      return undefined;
    }

    if (method === "state.list") {
      const { prefix } = data as { prefix?: string };
      guard.checkStateRead();
      if (!orchestrator) throw new Error("State service not available");
      const normalizedPrefix = prefix ? normalizeStateKey(prefix) : "";
      const storagePrefix = `${pluginStatePrefix(manifest.id)}${normalizedPrefix}`;
      const keys = await orchestrator.memoryList(storagePrefix);
      const trimPrefix = pluginStatePrefix(manifest.id);
      return keys.map((key) =>
        key.startsWith(trimPrefix) ? key.slice(trimPrefix.length) : key
      );
    }

    if (method === "state.clear") {
      guard.checkStateWrite();
      if (!orchestrator) throw new Error("State service not available");
      const prefix = pluginStatePrefix(manifest.id);
      const keys = await orchestrator.memoryList(prefix, { limit: 1000 });
      for (const key of keys) {
        await orchestrator.memoryDelete(key);
      }
      return { cleared: keys.length };
    }

    if (method === "network.fetch") {
      const {
        url,
        method: httpMethod,
        headers,
        body,
      } = data as {
        url: string;
        method?: string;
        headers?: Record<string, string>;
        body?: string;
      };

      guard.checkNetworkAccess(url, httpMethod || "GET");

      const response = await fetch(url, {
        method: httpMethod || "GET",
        headers,
        body,
      });

      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });

      return {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
        body: await response.text(),
      };
    }

    if (method === "log") {
      const { level, message, meta, pluginId } = data as {
        level: "debug" | "info" | "warn" | "error";
        message: string;
        meta?: Record<string, unknown>;
        pluginId: string;
      };

      if (guard.checkLogLevel(level)) {
        deps.logger[level](`[${pluginId}] ${message}`, meta);
      }
      return undefined;
    }

    if (method === "memory.get") {
      const { key } = data as { key: string };
      guard.checkMemoryRead(key);
      if (!orchestrator) throw new Error("Memory service not available");
      return orchestrator.memoryGet(key);
    }

    if (method === "memory.set") {
      const { key, value, options } = data as {
        key: string;
        value: unknown;
        options?: { ttlSeconds?: number };
      };
      guard.checkMemoryWrite(key);
      if (!orchestrator) throw new Error("Memory service not available");
      await orchestrator.memorySet(key, value, options);
      return undefined;
    }

    if (method === "memory.delete") {
      const { key } = data as { key: string };
      guard.checkMemoryWrite(key);
      if (!orchestrator) throw new Error("Memory service not available");
      await orchestrator.memoryDelete(key);
      return undefined;
    }

    if (method === "memory.list") {
      const { prefix, options } = data as {
        prefix?: string;
        options?: { limit?: number };
      };
      guard.checkMemoryRead(prefix ?? "*");
      if (!orchestrator) throw new Error("Memory service not available");
      return orchestrator.memoryList(prefix, options);
    }

    if (method === "memory.ttl") {
      const { key } = data as { key: string };
      guard.checkMemoryRead(key);
      if (!orchestrator) throw new Error("Memory service not available");
      return orchestrator.memoryTtl(key);
    }

    if (method === "skills.invoke") {
      const { skillName, args } = data as {
        skillName: string;
        args: Record<string, unknown>;
      };
      guard.checkSkillAccess(skillName);
      if (!orchestrator) throw new Error("Skill invocation not available");
      const result = await orchestrator.executeSkill(skillName, args);
      if (!result.success) {
        throw new Error(result.error || "Skill execution failed");
      }
      return result.result;
    }

    if (method === "fs.readText") {
      const { path: requestedPath } = data as { path: string };
      const { absolutePath, relativePath } = resolvePluginRelativePath(
        manifest,
        requestedPath,
      );
      guard.checkFSRead(relativePath);
      return fs.readFile(absolutePath, "utf-8");
    }

    if (method === "fs.writeText") {
      const { path: requestedPath, content } = data as {
        path: string;
        content: string;
      };
      const { absolutePath, relativePath } = resolvePluginRelativePath(
        manifest,
        requestedPath,
      );
      guard.checkFSWrite(relativePath);
      await fs.mkdir(path.dirname(absolutePath), { recursive: true });
      await fs.writeFile(absolutePath, content, "utf-8");
      return undefined;
    }

    if (method === "fs.list") {
      const { path: requestedPath } = data as { path?: string };
      const targetPath = requestedPath || ".";
      const { absolutePath, relativePath } = resolvePluginRelativePath(
        manifest,
        targetPath,
      );
      guard.checkFSRead(relativePath);
      const entries = await fs.readdir(absolutePath, { withFileTypes: true });
      return entries.map((entry) =>
        entry.isDirectory() ? `${entry.name}/` : entry.name,
      );
    }

    if (method === "llm.chat") {
      const {
        messages,
        systemPrompt,
        maxTokens,
        temperature,
        model,
        provider,
      } = data as {
        messages: Array<{
          role: "system" | "user" | "assistant";
          content: string;
        }>;
        systemPrompt?: string;
        maxTokens?: number;
        temperature?: number;
        model?: string;
        provider?: string;
      };

      guard.checkLLMInvocation(model, provider);

      const maxAllowedTokens = manifest.permissions.llm?.max_tokens_per_request;
      if (
        typeof maxAllowedTokens === "number" &&
        typeof maxTokens === "number" &&
        maxTokens > maxAllowedTokens
      ) {
        throw new PermissionDeniedError(
          manifest.id,
          "llm.max_tokens_per_request",
          `request ${maxTokens} tokens`,
        );
      }

      if (!deps.llm) {
        throw new Error("LLM adapter not available");
      }

      return deps.llm.chat({
        messages,
        systemPrompt,
        maxTokens: typeof maxAllowedTokens === "number"
          ? Math.min(maxTokens ?? maxAllowedTokens, maxAllowedTokens)
          : maxTokens,
        temperature,
        model,
        provider,
      });
    }

    throw new Error(`Unknown system call: ${method}`);
  };
}

export { PermissionGuard, PermissionDeniedError };
