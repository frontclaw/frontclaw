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
    const guard = new PermissionGuard(manifest);
    const data = payload as Record<string, unknown>;

    if (method === "db.query") {
      const { sql, params } = data as { sql: string; params?: unknown[] };
      const tableMatch = sql.match(/(?:FROM|INTO|UPDATE)\s+["']?(\w+)["']?/i);
      const table = tableMatch?.[1] || "*";
      const isWrite = /^(INSERT|UPDATE|DELETE)/i.test(sql.trim());

      guard.checkDBAccess(table, isWrite);
      return deps.db.query(sql, params);
    }

    if (method === "db.getItems") {
      const { table, where, limit, offset } = data as {
        table: string;
        where?: Record<string, unknown>;
        limit?: number;
        offset?: number;
      };
      guard.checkDBAccess(table, false);
      return deps.db.getItems(table, { where, limit, offset });
    }

    if (method === "db.getItem") {
      const { table, id } = data as { table: string; id: string };
      guard.checkDBAccess(table, false);
      return deps.db.getItem(table, id);
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

      guard.checkNetworkAccess(url);

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

    throw new Error(`Unknown system call: ${method}`);
  };
}

export { PermissionGuard, PermissionDeniedError };
