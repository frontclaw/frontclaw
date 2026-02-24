import { createOrchestratorRuntime } from "@workspace/core";
import path from "node:path";
import { createPluginSystemLogger, createScopedLogger } from "../lib/logging";
import { getAIClient } from "./ai-client";

const appLogger = createScopedLogger("orchestrator");
const pluginLogger = createPluginSystemLogger();

const runtime = createOrchestratorRuntime({
  pluginsDir: path.resolve(import.meta.dirname, "../../../../plugins"),
  getAIClient,
  pluginLogger,
  appLogger,
  hookTimeout: 5000,
});

export const orchestrator = runtime.orchestrator;

export function waitForOrchestratorReady(): Promise<void> {
  return runtime.waitForReady();
}

export async function refreshOrchestrator(): Promise<void> {
  await runtime.refresh();
}
