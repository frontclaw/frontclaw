import type { Orchestrator } from "@workspace/core";
import type { AIClientInstance } from "../services/ai-client";
import type { RefreshResult } from "../services/runtime-refresh";

export type RouteDeps = {
  orchestrator: Orchestrator;
  awaitOrchestratorReady: () => Promise<void>;
  refreshApplicationRuntime: () => Promise<RefreshResult>;
  isRefreshInProgress: () => boolean;
  upgradeWebSocket?: any;
};

export type AIRouteDeps = RouteDeps & {
  awaitAIReady: () => Promise<void>;
  getAIClient: () => AIClientInstance;
  getConfiguredSystemPrompt: () => string;
};
