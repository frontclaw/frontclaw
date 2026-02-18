import type { Orchestrator } from "@workspace/core";
import type { AIClientInstance } from "../services/ai-client";

export type RouteDeps = {
  orchestrator: Orchestrator;
  orchestratorReady: Promise<void>;
};

export type AIRouteDeps = RouteDeps & {
  aiReady: Promise<void>;
  getAIClient: () => AIClientInstance;
  getConfiguredSystemPrompt: () => string;
};
