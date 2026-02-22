import { Hono } from "hono";
import { logger } from "hono/logger";
import { registerRoutes } from "./routes";
import {
  waitForAIReady,
  getAIClient,
  getConfiguredSystemPrompt,
} from "./services/ai-client";
import {
  orchestrator,
  waitForOrchestratorReady,
} from "./services/orchestrator";
import {
  isRefreshInProgress,
  refreshApplicationRuntime,
} from "./services/runtime-refresh";

const app = new Hono();
app.use(logger());

registerRoutes(app, {
  orchestrator,
  awaitOrchestratorReady: waitForOrchestratorReady,
  awaitAIReady: waitForAIReady,
  refreshApplicationRuntime,
  isRefreshInProgress,
  getAIClient,
  getConfiguredSystemPrompt,
});

waitForAIReady()
  .then(() => {
    console.log("AI client initialized from frontclaw.json");
  })
  .catch((error) => {
    console.error("Failed to initialize AI client:", error);
  });

process.on("SIGINT", async () => {
  console.log("Shutting down...");
  await orchestrator.stop();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("Shutting down...");
  await orchestrator.stop();
  process.exit(0);
});

Bun.serve({ fetch: app.fetch, idleTimeout: 50, port: 9901 });
