import type { Hono } from "hono";
import { registerAIRoutes } from "./ai";
import { registerConfigRoutes } from "./config";
import { registerInteractionAndFeedbackRoutes } from "./interactions-feedback";
import { registerItemRoutes } from "./items";
import { registerMiscRoutes } from "./misc";
import { registerPluginRoutes } from "./plugins";
import { registerProfileRoutes } from "./profiles";
import { registerSystemRoutes } from "./system";
import type { AIRouteDeps, RouteDeps } from "./types";

export function registerRoutes(
  app: Hono,
  deps: RouteDeps &
    Pick<AIRouteDeps, "aiReady" | "getAIClient" | "getConfiguredSystemPrompt">,
) {
  registerSystemRoutes(app, deps);
  registerPluginRoutes(app, deps);
  registerAIRoutes(app, deps);
  registerConfigRoutes(app);
  registerProfileRoutes(app);
  registerItemRoutes(app);
  registerInteractionAndFeedbackRoutes(app);
  registerMiscRoutes(app);
}
