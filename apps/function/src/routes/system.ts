import type { Hono } from "hono";
import type { RouteDeps } from "./types";

export function registerSystemRoutes(app: Hono, deps: RouteDeps) {
  const {
    orchestrator,
    refreshApplicationRuntime,
    isRefreshInProgress,
    awaitOrchestratorReady,
  } = deps;

  app.get("/", (c) => {
    return c.json({
      success: true,
      message: "FrontClaw API is running!",
      version: "1.0.0",
      environment: "development",
      plugins: orchestrator.getManifests().map((m) => ({
        id: m.id,
        name: m.name,
        version: m.version,
        priority: m.priority,
        runtime: m.runtime,
      })),
      apis: {
        health: "/api/v1/health",
        refresh: "/api/v1/refresh",
        plugins: "/api/v1/plugins",
        skills: "/api/v1/skills",
        memory: "/api/v1/memory",
        configure: "/api/v1/configure",
        profiles: "/api/v1/profiles",
        items: "/api/v1/items",
        conversations: "/api/v1/conversations",
        messages: "/api/v1/conversations/:conversationId/messages",
        compactConversation:
          "/api/v1/conversations/:conversationId/compact",
        conversationMetrics:
          "/api/v1/conversations/:conversationId/metrics",
        interactions: "/api/v1/interactions",
        autocomplete: "/api/v1/autocomplete",
        search: "/api/v1/search",
        chat: "/api/v1/chat",
        webhooks: "/api/v1/webhooks",
      },
    });
  });

  app.get("/api/v1/health", (c) => {
    return c.json({
      success: true,
      message: "FrontClaw API is healthy!",
      orchestrator: orchestrator.running ? "running" : "stopped",
      plugins: orchestrator.getManifests().length,
      refreshing: isRefreshInProgress(),
    });
  });

  app.post("/api/v1/refresh", async (c) => {
    const adminToken = process.env.FRONTCLAW_ADMIN_TOKEN;
    if (adminToken) {
      const provided = c.req.header("x-admin-token");
      if (provided !== adminToken) {
        return c.json({ success: false, message: "Unauthorized" }, 401);
      }
    }

    try {
      await awaitOrchestratorReady();
      const result = await refreshApplicationRuntime();

      return c.json({
        success: true,
        message: "Application runtime refreshed",
        ...result,
      });
    } catch (error) {
      return c.json(
        {
          success: false,
          message: "Failed to refresh application runtime",
          error: (error as Error).message,
        },
        500,
      );
    }
  });
}
