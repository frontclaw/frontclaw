import { createAIClient } from "../ai/index.js";

export type AIClientInstance = ReturnType<typeof createAIClient>;

export type AIRuntimeInitResult = {
  client: AIClientInstance;
  configuredSystemPrompt?: string;
};

export type AIRuntimeManagerOptions = {
  initialize: () => Promise<AIRuntimeInitResult>;
  initialClient?: AIClientInstance;
  autoInitialize?: boolean;
};

export type AIRuntimeManager = {
  waitForReady: () => Promise<void>;
  reload: () => Promise<void>;
  getClient: () => AIClientInstance;
  getConfiguredSystemPrompt: () => string;
};

export function createAIRuntimeManager(
  options: AIRuntimeManagerOptions,
): AIRuntimeManager {
  let aiClient = options.initialClient ?? createAIClient();
  let configuredSystemPrompt = "";
  let readyPromise: Promise<void> | null = null;
  let reloadPromise: Promise<void> | null = null;

  const initialize = async (): Promise<void> => {
    const result = await options.initialize();
    aiClient = result.client;
    configuredSystemPrompt = result.configuredSystemPrompt ?? "";
  };

  const ensureReady = (): Promise<void> => {
    if (!readyPromise) {
      readyPromise = initialize();
    }
    return readyPromise;
  };

  const reload = async (): Promise<void> => {
    if (reloadPromise) return reloadPromise;
    reloadPromise = (async () => {
      const nextReady = initialize();
      readyPromise = nextReady;
      await nextReady;
    })().finally(() => {
      reloadPromise = null;
    });
    return reloadPromise;
  };

  if (options.autoInitialize !== false) {
    void ensureReady();
  }

  return {
    waitForReady: ensureReady,
    reload,
    getClient: () => aiClient,
    getConfiguredSystemPrompt: () => configuredSystemPrompt,
  };
}
