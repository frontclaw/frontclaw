import type { Hono } from "hono";
import type { RouteDeps } from "./types";

export function registerSystemRoutes(app: Hono, deps: RouteDeps) {
  const { orchestrator } = deps;

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
      })),
      apis: {
        health: "/api/v1/health",
        plugins: "/api/v1/plugins",
        skills: "/api/v1/skills",
        memory: "/api/v1/memory",
        configure: "/api/v1/configure",
        profiles: "/api/v1/profiles",
        items: "/api/v1/items",
        conversations: "/api/v1/conversations",
        messages: "/api/v1/conversations/:conversationId/messages",
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
    });
  });
}
