/**
 * Permission Guard
 * Validates and enforces plugin permissions for system calls
 */

import type { LoadedPluginManifest } from "@workspace/plugin-sdk";
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
   * Check if plugin can read its local state
   */
  checkStateRead(): void {
    const statePerm = this.manifest.permissions.state;
    if (!statePerm?.enabled || statePerm.read === false) {
      throw new PermissionDeniedError(
        this.manifest.id,
        "state.read",
        "read plugin state",
      );
    }
  }

  /**
   * Check if plugin can write its local state
   */
  checkStateWrite(): void {
    const statePerm = this.manifest.permissions.state;
    if (!statePerm?.enabled || statePerm.write === false) {
      throw new PermissionDeniedError(
        this.manifest.id,
        "state.write",
        "write plugin state",
      );
    }
  }

  /**
   * Check if plugin can fetch a URL
   */
  checkNetworkAccess(url: string, method = "GET"): void {
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
    let normalizedUrl: URL;
    try {
      normalizedUrl = new URL(url);
      domain = normalizedUrl.hostname;
    } catch {
      throw new PermissionDeniedError(
        this.manifest.id,
        "network",
        `fetch invalid URL '${url}'`,
      );
    }

    const endpointPerms = netPerm.allowed_http_endpoints ?? [];
    const domainPerms = netPerm.allowed_domains ?? [];

    // If endpoint-level permissions are provided, they fully define allowed egress.
    // In this mode, allowed_domains is optional (no duplication required).
    if (endpointPerms.length > 0) {
      const methodUpper = method.toUpperCase();
      const target = `${normalizedUrl.origin}${normalizedUrl.pathname}`;
      const endpointAllowed = endpointPerms.some((entry) => {
        const trimmed = entry.trim();
        if (!trimmed) return false;

        const firstSpace = trimmed.indexOf(" ");
        let allowedMethod = "*";
        let urlPattern = trimmed;
        if (firstSpace > 0) {
          allowedMethod = trimmed.slice(0, firstSpace).toUpperCase();
          urlPattern = trimmed.slice(firstSpace + 1).trim();
        }

        if (allowedMethod !== "*" && allowedMethod !== methodUpper) {
          return false;
        }

        if (urlPattern.endsWith("*")) {
          const prefix = urlPattern.slice(0, -1);
          return target.startsWith(prefix);
        }

        return target === urlPattern;
      });

      if (!endpointAllowed) {
        throw new PermissionDeniedError(
          this.manifest.id,
          "network.allowed_http_endpoints",
          `fetch endpoint '${methodUpper} ${target}'`,
        );
      }
      return;
    }

    // Fallback to domain-level allowlist when no endpoint rules are provided.
    if (domainPerms.length === 0) {
      throw new PermissionDeniedError(
        this.manifest.id,
        "network",
        `fetch '${url}'`,
      );
    }

    const isAllowed = domainPerms.some((allowed) => {
      if (allowed.startsWith("*.")) {
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
   * Check if plugin can modify LLM responses
   */
  checkResponseModification(): void {
    if (!this.manifest.permissions.llm?.can_modify_response) {
      throw new PermissionDeniedError(
        this.manifest.id,
        "llm.can_modify_response",
        "modify LLM response",
      );
    }
  }

  /**
   * Check if plugin can call the host LLM adapter
   */
  checkLLMInvocation(model?: string, provider?: string): void {
    const llmPerm = this.manifest.permissions.llm;
    if (!llmPerm?.can_call_provider) {
      throw new PermissionDeniedError(
        this.manifest.id,
        "llm.can_call_provider",
        "invoke LLM provider",
      );
    }

    const allowedProviders = llmPerm.allowed_providers ?? [];
    if (
      provider &&
      allowedProviders.length > 0 &&
      !allowedProviders.includes(provider) &&
      !allowedProviders.includes("*")
    ) {
      throw new PermissionDeniedError(
        this.manifest.id,
        "llm.allowed_providers",
        `use provider '${provider}'`,
      );
    }

    const allowedModels = llmPerm.allowed_models ?? [];
    if (
      model &&
      allowedModels.length > 0 &&
      !allowedModels.includes(model) &&
      !allowedModels.includes("*")
    ) {
      throw new PermissionDeniedError(
        this.manifest.id,
        "llm.allowed_models",
        `use model '${model}'`,
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

  /**
   * Check if plugin can read from plugin-local filesystem path
   */
  checkFSRead(path: string): void {
    const fsPerm = this.manifest.permissions.fs?.read || [];
    if (fsPerm.length === 0) {
      throw new PermissionDeniedError(
        this.manifest.id,
        "fs.read",
        `read path '${path}'`,
      );
    }
    if (!this.matchesPath(path, fsPerm)) {
      throw new PermissionDeniedError(
        this.manifest.id,
        "fs.read",
        `read path '${path}'`,
      );
    }
  }

  /**
   * Check if plugin can write to plugin-local filesystem path
   */
  checkFSWrite(path: string): void {
    const fsPerm = this.manifest.permissions.fs?.write || [];
    if (fsPerm.length === 0) {
      throw new PermissionDeniedError(
        this.manifest.id,
        "fs.write",
        `write path '${path}'`,
      );
    }
    if (!this.matchesPath(path, fsPerm)) {
      throw new PermissionDeniedError(
        this.manifest.id,
        "fs.write",
        `write path '${path}'`,
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

  private matchesPath(path: string, patterns: string[]): boolean {
    const normalizedPath = path
      .trim()
      .replaceAll("\\", "/")
      .replace(/^\.\/+/, "")
      .replace(/^\/+/, "");

    return patterns.some((rawPattern) => {
      const pattern = rawPattern
        .trim()
        .replaceAll("\\", "/")
        .replace(/^\.\/+/, "")
        .replace(/^\/+/, "");
      if (pattern === "*" || pattern === "**") return true;
      if (pattern.endsWith("/**")) {
        const prefix = pattern.slice(0, -3);
        return normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`);
      }
      if (pattern.endsWith("/*")) {
        const prefix = pattern.slice(0, -2);
        if (!normalizedPath.startsWith(`${prefix}/`)) return false;
        return !normalizedPath.slice(prefix.length + 1).includes("/");
      }
      return normalizedPath === pattern;
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
