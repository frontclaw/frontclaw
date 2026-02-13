import type { Hono } from "hono";
import type { RouteDeps } from "./types";

export function registerPluginRoutes(app: Hono, deps: RouteDeps) {
  const { orchestrator, orchestratorReady } = deps;

  app.get("/api/v1/plugins", async (c) => {
    await orchestratorReady;
    return c.json({
      success: true,
      plugins: orchestrator.getManifests().map((m) => ({
        id: m.id,
        name: m.name,
        version: m.version,
        description: m.description,
        priority: m.priority,
        permissions: m.permissions,
        tags: m.tags,
      })),
    });
  });

  app.get("/api/v1/skills", async (c) => {
    await orchestratorReady;
    const skills = await orchestrator.collectSkills();
    return c.json({
      success: true,
      skills,
    });
  });

  app.get("/api/v1/memory", async (c) => {
    await orchestratorReady;
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
    await orchestratorReady;
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
        permissions: manifest.permissions,
        config: manifest.config,
        tags: manifest.tags,
      },
    });
  });

  app.all("/api/v1/p/:pluginId/*", async (c) => {
    await orchestratorReady;
    const pluginId = c.req.param("pluginId");
    const fullPath = c.req.path;
    const pluginPath = fullPath.replace(`/api/v1/p/${pluginId}`, "");

    const response = await orchestrator.routeHTTPRequest(pluginId, {
      method: c.req.method,
      path: pluginPath || "/",
      params: c.req.param() as Record<string, string>,
      query: c.req.query() as Record<string, string>,
      headers: Object.fromEntries(c.req.raw.headers.entries()),
      body: c.req.method !== "GET" ? await c.req.json().catch(() => null) : null,
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
