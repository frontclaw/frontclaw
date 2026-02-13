/**
 * Permission Guard
 * Validates and enforces plugin permissions for system calls
 */

import type {
  LoadedPluginManifest,
  Permissions,
  DBPermission,
  NetworkPermission,
} from "@workspace/plugin-sdk";
import { parseRouteSpec, routeMatches } from "./permission-route-utils.js";

/** Permission violation error */
export class PermissionDeniedError extends Error {
  constructor(
    public readonly pluginId: string,
    public readonly permission: string,
    public readonly action: string,
  ) {
    super(
      `Plugin '${pluginId}' denied: ${permission} permission required for ${action}`,
    );
    this.name = "PermissionDeniedError";
  }
}

/**
 * PermissionGuard
 * Validates system calls against plugin permissions
 */
export class PermissionGuard {
  constructor(private readonly manifest: LoadedPluginManifest) {}

  /**
   * Check if plugin has database access
   */
  checkDBAccess(table: string, write = false): void {
    const dbPerm = this.manifest.permissions.db;

    if (!dbPerm) {
      throw new PermissionDeniedError(
        this.manifest.id,
        "db",
        `access table '${table}'`,
      );
    }

    // Check if table is in allowed list
    if (!dbPerm.tables.includes(table) && !dbPerm.tables.includes("*")) {
      throw new PermissionDeniedError(
        this.manifest.id,
        "db.tables",
        `access table '${table}'`,
      );
    }

    // Check write access
    if (write && dbPerm.access === "read-only") {
      throw new PermissionDeniedError(
        this.manifest.id,
        "db.access",
        `write to table '${table}'`,
      );
    }
  }

  /**
   * Check if plugin can fetch a URL
   */
  checkNetworkAccess(url: string): void {
    const netPerm = this.manifest.permissions.network;

    if (!netPerm) {
      throw new PermissionDeniedError(
        this.manifest.id,
        "network",
        `fetch '${url}'`,
      );
    }

    // Allow all if specified
    if (netPerm.allow_all) {
      return;
    }

    // Parse the URL to get the domain
    let domain: string;
    try {
      const parsed = new URL(url);
      domain = parsed.hostname;
    } catch {
      throw new PermissionDeniedError(
        this.manifest.id,
        "network",
        `fetch invalid URL '${url}'`,
      );
    }

    // Check if domain is allowed
    const isAllowed = netPerm.allowed_domains.some((allowed) => {
      if (allowed.startsWith("*.")) {
        // Wildcard subdomain matching
        const base = allowed.slice(2);
        return domain === base || domain.endsWith(`.${base}`);
      }
      return domain === allowed;
    });

    if (!isAllowed) {
      throw new PermissionDeniedError(
        this.manifest.id,
        "network.allowed_domains",
        `fetch domain '${domain}'`,
      );
    }
  }

  /**
   * Check if plugin can modify prompts
   */
  checkPromptModification(): void {
    if (!this.manifest.permissions.llm?.can_modify_prompt) {
      throw new PermissionDeniedError(
        this.manifest.id,
        "llm.can_modify_prompt",
        "modify user prompt",
      );
    }
  }

  /**
   * Check if plugin can modify system messages
   */
  checkSystemMessageModification(): void {
    if (!this.manifest.permissions.llm?.can_modify_system_message) {
      throw new PermissionDeniedError(
        this.manifest.id,
        "llm.can_modify_system_message",
        "modify system message",
      );
    }
  }

  /**
   * Check if plugin can intercept tasks
   */
  checkTaskInterception(): void {
    if (!this.manifest.permissions.llm?.can_intercept_task) {
      throw new PermissionDeniedError(
        this.manifest.id,
        "llm.can_intercept_task",
        "intercept task",
      );
    }
  }

  /**
   * Check if plugin can intercept socket events
   */
  checkSocketIntercept(event: string): void {
    const socketPerm = this.manifest.permissions.socket;

    if (!socketPerm?.can_intercept) {
      throw new PermissionDeniedError(
        this.manifest.id,
        "socket.can_intercept",
        `intercept socket event '${event}'`,
      );
    }

    // Check if specific event is allowed
    if (
      socketPerm.events &&
      socketPerm.events.length > 0 &&
      !socketPerm.events.includes(event) &&
      !socketPerm.events.includes("*")
    ) {
      throw new PermissionDeniedError(
        this.manifest.id,
        "socket.events",
        `intercept socket event '${event}'`,
      );
    }
  }

  /**
   * Check if plugin can emit to sockets
   */
  checkSocketEmit(): void {
    if (!this.manifest.permissions.socket?.can_emit) {
      throw new PermissionDeniedError(
        this.manifest.id,
        "socket.can_emit",
        "emit to socket",
      );
    }
  }

  /**
   * Check if plugin has permission for a log level
   */
  checkLogLevel(level: "debug" | "info" | "warn" | "error"): boolean {
    const logPerm = this.manifest.permissions.log;

    if (!logPerm?.enabled) {
      return false;
    }

    return logPerm.levels?.includes(level) ?? true;
  }

  /**
   * Check if plugin can expose/execute a skill
   */
  checkSkillAccess(skillName: string): void {
    const skillsPerm = this.manifest.permissions.skills;
    if (!skillsPerm || skillsPerm.length === 0) {
      throw new PermissionDeniedError(
        this.manifest.id,
        "skills",
        `expose skill '${skillName}'`,
      );
    }
    const baseName = skillName.includes("__")
      ? skillName.split("__").slice(1).join("__")
      : skillName;
    const hasWildcard = skillsPerm.includes("*");
    const hasExact = skillsPerm.includes(skillName) || skillsPerm.includes(baseName);
    const hasPrefix = skillsPerm.some(
      (entry) =>
        entry.endsWith("__*") && skillName.startsWith(entry.slice(0, -2)),
    );
    if (!hasWildcard && !hasExact && !hasPrefix) {
      throw new PermissionDeniedError(
        this.manifest.id,
        "skills",
        `expose skill '${skillName}'`,
      );
    }
  }

  /**
   * Check if plugin can read memory key
   */
  checkMemoryRead(key: string): void {
    const memoryPerm = this.manifest.permissions.memory?.read || [];
    if (memoryPerm.length === 0) {
      throw new PermissionDeniedError(
        this.manifest.id,
        "memory.read",
        `read memory '${key}'`,
      );
    }
    if (!this.matchesKey(key, memoryPerm)) {
      throw new PermissionDeniedError(
        this.manifest.id,
        "memory.read",
        `read memory '${key}'`,
      );
    }
  }

  /**
   * Check if plugin can write memory key
   */
  checkMemoryWrite(key: string): void {
    const memoryPerm = this.manifest.permissions.memory?.write || [];
    if (memoryPerm.length === 0) {
      throw new PermissionDeniedError(
        this.manifest.id,
        "memory.write",
        `write memory '${key}'`,
      );
    }
    if (!this.matchesKey(key, memoryPerm)) {
      throw new PermissionDeniedError(
        this.manifest.id,
        "memory.write",
        `write memory '${key}'`,
      );
    }
  }

  private matchesKey(key: string, patterns: string[]): boolean {
    const normalizedKey = key.trim();
    return patterns.some((pattern) => {
      if (pattern === "*") return true;
      if (pattern.endsWith(":*")) {
        const prefix = pattern.slice(0, -2);
        return normalizedKey.startsWith(prefix);
      }
      return normalizedKey === pattern;
    });
  }

  /**
   * Check if plugin can handle a specific API route
   */
  checkAPIRoute(path: string, method: string): void {
    const apiPerm = this.manifest.permissions.api;

    if (!apiPerm) {
      throw new PermissionDeniedError(
        this.manifest.id,
        "api",
        `handle route ${method} ${path}`,
      );
    }

    // Check if route matches any allowed pattern
    const matchedRoute = apiPerm.routes.some((route) => {
      const { path: routePath, methods } = parseRouteSpec(route);
      const matchesPath = routeMatches(path, routePath);
      if (!matchesPath) return false;

      // If methods are specified in the route itself, enforce them
      if (methods && methods.length > 0) {
        return methods.includes(method.toUpperCase());
      }

      // Otherwise fall back to top-level methods if provided
      if (apiPerm.methods && apiPerm.methods.length > 0) {
        return apiPerm.methods.includes(method as any);
      }

      // No method restrictions
      return true;
    });

    if (!matchedRoute) {
      throw new PermissionDeniedError(
        this.manifest.id,
        "api.routes",
        `handle route ${path}`,
      );
    }

    // If route spec had no methods and apiPerm.methods is defined, enforce it
    if (apiPerm.methods && apiPerm.methods.length > 0) {
      if (!apiPerm.methods.includes(method as any)) {
        throw new PermissionDeniedError(
          this.manifest.id,
          "api.methods",
          `use method ${method}`,
        );
      }
    }
  }
}
