import type { Hono } from "hono";
import fs from "node:fs";
import path from "node:path";
import type { RouteDeps } from "./types";

const PLUGINS_DIR = path.resolve(import.meta.dirname, "../../../../plugins");

type PluginCatalogEntry = {
  id: string;
  name?: string;
  version?: string;
  description?: string;
  priority?: number;
  runtime?: string;
  permissions?: unknown;
  tags?: string[];
  manifest?: Record<string, unknown>;
  enabled: boolean;
  active: boolean;
};

function readPluginCatalog(): PluginCatalogEntry[] {
  if (!fs.existsSync(PLUGINS_DIR)) {
    return [];
  }

  const entries = fs.readdirSync(PLUGINS_DIR, { withFileTypes: true });
  const plugins: PluginCatalogEntry[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const pluginDir = path.join(PLUGINS_DIR, entry.name);
    const manifestPath = path.join(pluginDir, "frontclaw.json");
    if (!fs.existsSync(manifestPath)) continue;

    try {
      const raw = fs.readFileSync(manifestPath, "utf-8");
      const manifest = JSON.parse(raw) as Record<string, unknown>;
      const id =
        typeof manifest.id === "string" && manifest.id.trim()
          ? manifest.id
          : entry.name;
      const enabled = manifest.enabled !== false;

      plugins.push({
        id,
        name: typeof manifest.name === "string" ? manifest.name : undefined,
        version:
          typeof manifest.version === "string" ? manifest.version : undefined,
        description:
          typeof manifest.description === "string"
            ? manifest.description
            : undefined,
        priority:
          typeof manifest.priority === "number" ? manifest.priority : undefined,
        runtime:
          typeof manifest.runtime === "string" ? manifest.runtime : undefined,
        permissions: manifest.permissions,
        tags: Array.isArray(manifest.tags)
          ? manifest.tags.filter((tag) => typeof tag === "string")
          : undefined,
        manifest,
        enabled,
        active: false,
      });
    } catch {
      // Ignore malformed plugin manifests in catalog listing.
    }
  }

  plugins.sort((a, b) => a.id.localeCompare(b.id));
  return plugins;
}

function writePluginEnabled(pluginId: string, enabled: boolean): void {
  if (!fs.existsSync(PLUGINS_DIR)) {
    throw new Error("Plugin not found");
  }

  const entries = fs.readdirSync(PLUGINS_DIR, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const manifestPath = path.join(PLUGINS_DIR, entry.name, "frontclaw.json");
    if (!fs.existsSync(manifestPath)) continue;

    try {
      const raw = fs.readFileSync(manifestPath, "utf-8");
      const manifest = JSON.parse(raw) as Record<string, unknown>;
      if (manifest.id !== pluginId) continue;

      manifest.enabled = enabled;
      fs.writeFileSync(
        manifestPath,
        `${JSON.stringify(manifest, null, 2)}\n`,
        "utf-8",
      );
      return;
    } catch {
      // Skip malformed manifest and keep scanning.
    }
  }

  throw new Error("Plugin not found");
}

export function registerPluginRoutes(app: Hono, deps: RouteDeps) {
  const {
    orchestrator,
    awaitOrchestratorReady,
    refreshApplicationRuntime,
    isRefreshInProgress,
  } = deps;

  app.get("/api/v1/plugins", async (c) => {
    await awaitOrchestratorReady();
    const activeIds = new Set(orchestrator.getManifests().map((m) => m.id));
    const catalog = readPluginCatalog().map((plugin) => ({
      ...plugin,
      active: activeIds.has(plugin.id),
    }));

    return c.json({
      success: true,
      plugins: catalog,
    });
  });

  app.patch("/api/v1/plugins/:pluginId/enabled", async (c) => {
    const adminToken = process.env.FRONTCLAW_ADMIN_TOKEN;
    if (adminToken) {
      const provided = c.req.header("x-admin-token");
      if (provided !== adminToken) {
        return c.json({ success: false, message: "Unauthorized" }, 401);
      }
    }

    const pluginId = c.req.param("pluginId");
    const body = (await c.req.json().catch(() => null)) as
      | { enabled?: unknown }
      | null;

    if (!body || typeof body.enabled !== "boolean") {
      return c.json(
        {
          success: false,
          message: "Body must include boolean field 'enabled'",
        },
        400,
      );
    }

    if (isRefreshInProgress()) {
      return c.json(
        {
          success: false,
          message: "Refresh already in progress, retry shortly",
        },
        409,
      );
    }

    try {
      writePluginEnabled(pluginId, body.enabled);
      const refresh = await refreshApplicationRuntime();
      const manifest = orchestrator.getManifest(pluginId);

      return c.json({
        success: true,
        message: `Plugin '${pluginId}' ${body.enabled ? "enabled" : "disabled"}`,
        plugin: {
          id: pluginId,
          enabled: body.enabled,
          active: Boolean(manifest),
        },
        refresh,
      });
    } catch (error) {
      const message = (error as Error).message;
      const status = message === "Plugin not found" ? 404 : 500;
      return c.json(
        {
          success: false,
          message,
        },
        status as 404 | 500,
      );
    }
  });

  app.get("/api/v1/tools", async (c) => {
    await awaitOrchestratorReady();
    const tools = await orchestrator.collectTools();
    return c.json({
      success: true,
      tools,
    });
  });

  app.get("/api/v1/skills", async (c) => {
    await awaitOrchestratorReady();
    const skills = await orchestrator.collectSkills();
    return c.json({
      success: true,
      skills,
    });
  });

  app.get("/api/v1/memory", async (c) => {
    await awaitOrchestratorReady();
    const token = process.env.MEMORY_INSPECT_TOKEN;
    if (token) {
      const provided = c.req.header("x-admin-token");
      if (provided !== token) {
        return c.json({ success: false, message: "Unauthorized" }, 401);
      }
    }

    const prefix = c.req.query("prefix");
    const limitRaw = c.req.query("limit");
    const limit = limitRaw ? parseInt(limitRaw, 10) : undefined;

    const keys = await orchestrator.memoryList(prefix, { limit });
    const entries = await Promise.all(
      keys.map(async (key) => ({
        key,
        value: await orchestrator.memoryGet(key),
        ttlSeconds: await orchestrator.memoryTtl(key),
      })),
    );

    return c.json({
      success: true,
      count: entries.length,
      entries,
    });
  });

  app.get("/api/v1/plugins/:pluginId", async (c) => {
    await awaitOrchestratorReady();
    const pluginId = c.req.param("pluginId");
    const manifest = orchestrator.getManifest(pluginId);

    if (!manifest) {
      return c.json({ success: false, message: "Plugin not found" }, 404);
    }

    return c.json({
      success: true,
      plugin: {
        id: manifest.id,
        name: manifest.name,
        version: manifest.version,
        description: manifest.description,
        priority: manifest.priority,
        runtime: manifest.runtime,
        permissions: manifest.permissions,
        config: manifest.config,
        tags: manifest.tags,
      },
    });
  });

  app.all("/api/v1/p/:pluginId/*", async (c) => {
    await awaitOrchestratorReady();
    const pluginId = c.req.param("pluginId");
    const fullPath = c.req.path;
    const pluginPath = fullPath.replace(`/api/v1/p/${pluginId}`, "");

    const response = await orchestrator.routeHTTPRequest(pluginId, {
      method: c.req.method,
      path: pluginPath || "/",
      params: c.req.param() as Record<string, string>,
      query: c.req.query() as Record<string, string>,
      headers: Object.fromEntries(c.req.raw.headers.entries()),
      body:
        c.req.method !== "GET" ? await c.req.json().catch(() => null) : null,
    });
    console.log(response);

    if (!response) {
      return c.json({ success: false, message: "Route not found" }, 404);
    }

    const responseStatus = response.status as
      | 200
      | 201
      | 400
      | 401
      | 403
      | 404
      | 500;
    return c.json(response.body, responseStatus);
  });
}
