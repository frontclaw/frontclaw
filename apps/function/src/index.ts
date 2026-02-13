import { Hono } from "hono";
import { logger } from "hono/logger";
import { registerRoutes } from "./routes";
import { aiReady, getAIClient } from "./services/ai-client";
import { orchestrator, orchestratorReady } from "./services/orchestrator";

const app = new Hono();
app.use(logger());

registerRoutes(app, {
  orchestrator,
  orchestratorReady,
  aiReady,
  getAIClient,
});

aiReady
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

export default {
  ...app,
  port: 9901,
};
