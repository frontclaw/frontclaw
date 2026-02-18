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

function stripQuotedSegments(sql: string): string {
  return sql.replace(/'(?:''|[^'])*'/g, " ");
}

function normalizeSqlForAnalysis(sql: string): string {
  return stripQuotedSegments(sql)
    .replace(/--.*$/gm, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTableName(raw: string): string | null {
  const normalized = raw
    .replace(/["'`]/g, "")
    .split(".")
    .at(-1)
    ?.trim();

  if (!normalized) return null;
  if (!/^[a-zA-Z_][\w$]*$/.test(normalized)) return null;
  return normalized;
}

function extractTables(sql: string): string[] {
  const normalizedSql = normalizeSqlForAnalysis(sql);
  const tables = new Set<string>();
  const patterns = [
    /\bFROM\s+([`"]?[a-zA-Z_][\w$]*[`"]?(?:\.[`"]?[a-zA-Z_][\w$]*[`"]?)?)/gi,
    /\bJOIN\s+([`"]?[a-zA-Z_][\w$]*[`"]?(?:\.[`"]?[a-zA-Z_][\w$]*[`"]?)?)/gi,
    /\bINTO\s+([`"]?[a-zA-Z_][\w$]*[`"]?(?:\.[`"]?[a-zA-Z_][\w$]*[`"]?)?)/gi,
    /\bUPDATE\s+([`"]?[a-zA-Z_][\w$]*[`"]?(?:\.[`"]?[a-zA-Z_][\w$]*[`"]?)?)/gi,
    /\bDELETE\s+FROM\s+([`"]?[a-zA-Z_][\w$]*[`"]?(?:\.[`"]?[a-zA-Z_][\w$]*[`"]?)?)/gi,
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(normalizedSql)) !== null) {
      const table = extractTableName(match[1] ?? "");
      if (table) tables.add(table);
    }
  }

  return Array.from(tables);
}

function isWriteQuery(sql: string): boolean {
  const normalizedSql = normalizeSqlForAnalysis(sql);
  return /\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE|REPLACE)\b/i.test(
    normalizedSql,
  );
}

function validateSingleStatement(sql: string, pluginId: string): void {
  const normalizedSql = normalizeSqlForAnalysis(sql);
  const statements = normalizedSql
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);

  if (statements.length > 1) {
    throw new PermissionDeniedError(
      pluginId,
      "db.query",
      "execute multiple SQL statements",
    );
  }
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

    if (method === "db.query") {
      const { sql, params } = data as { sql: string; params?: unknown[] };
      validateSingleStatement(sql, manifest.id);
      const tables = extractTables(sql);
      const writeQuery = isWriteQuery(sql);

      if (tables.length === 0) {
        // Fail closed unless plugin has wildcard table access.
        guard.checkDBAccess("*", writeQuery);
      } else {
        for (const table of tables) {
          guard.checkDBAccess(table, writeQuery);
        }
      }

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
