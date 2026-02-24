import {
  Orchestrator,
  type OrchestratorConfig,
} from "../orchestrator/index.js";
import {
  RedisMemoryService,
  SecureMemoryService,
  type MemoryService,
} from "../memory/index.js";
import type { SystemLogger } from "../bridge/types.js";
import type { AIClientInstance } from "./ai-runtime.js";

export type RuntimeAppLogger = {
  info: (message: string, meta?: unknown, options?: { essential?: boolean }) => void;
  error: (message: string, meta?: unknown) => void;
};

export type OrchestratorRuntimeOptions = {
  pluginsDir: string;
  getAIClient: () => AIClientInstance;
  pluginLogger: SystemLogger;
  appLogger: RuntimeAppLogger;
  hookTimeout?: number;
  memoryService?: MemoryService;
};

export type OrchestratorRuntime = {
  orchestrator: Orchestrator;
  waitForReady: () => Promise<void>;
  refresh: () => Promise<void>;
};

function parseKey(value: string): Buffer {
  const trimmed = value.trim();
  const isHex = /^[0-9a-fA-F]+$/.test(trimmed);
  const buf = isHex ? Buffer.from(trimmed, "hex") : Buffer.from(trimmed, "base64");
  if (buf.length !== 32) {
    throw new Error("MEMORY_ENCRYPTION_KEY must be 32 bytes (hex or base64)");
  }
  return buf;
}

function resolveMemoryService(): MemoryService | undefined {
  const base = process.env.REDIS_URL
    ? new RedisMemoryService({
        url: process.env.REDIS_URL,
        namespace: process.env.MEMORY_NAMESPACE,
      })
    : undefined;

  if (!base) return undefined;
  if (!process.env.MEMORY_ENCRYPTION_KEY) return base;

  return new SecureMemoryService(base, {
    encryptionKey: parseKey(process.env.MEMORY_ENCRYPTION_KEY),
    signingKey: process.env.MEMORY_SIGNING_KEY
      ? parseKey(process.env.MEMORY_SIGNING_KEY)
      : undefined,
  });
}

export function createOrchestratorRuntime(
  options: OrchestratorRuntimeOptions,
): OrchestratorRuntime {
  const orchestratorConfig: OrchestratorConfig = {
    loader: {
      pluginsDir: options.pluginsDir,
      pluginConfigs: {},
      disabledPlugins: [],
    },
    dependencies: {
      logger: options.pluginLogger,
      llm: {
        async chat(llmOptions) {
          const aiClient = options.getAIClient();
          const result = await aiClient.chat({
            messages: llmOptions.messages,
            systemPrompt: llmOptions.systemPrompt,
            maxTokens: llmOptions.maxTokens,
            temperature: llmOptions.temperature,
          });
          return {
            content: result.content,
            usage: result.usage,
          };
        },
      },
    },
    memoryService: options.memoryService ?? resolveMemoryService(),
    hookTimeout: options.hookTimeout ?? 5000,
  };

  const orchestrator = new Orchestrator(orchestratorConfig);
  let readyPromise: Promise<void> | null = null;
  let refreshPromise: Promise<void> | null = null;

  const start = (): Promise<void> => {
    return orchestrator
      .start()
      .then(() => {
        options.appLogger.info(
          "Frontclaw Orchestrator started successfully",
          undefined,
          {
            essential: true,
          },
        );
      })
      .catch((error) => {
        options.appLogger.error("Failed to start Frontclaw Orchestrator", error);
        throw error;
      });
  };

  const ensureReady = (): Promise<void> => {
    if (!readyPromise) {
      readyPromise = start();
    }
    return readyPromise;
  };

  const refresh = async (): Promise<void> => {
    if (refreshPromise) return refreshPromise;
    refreshPromise = (async () => {
      await orchestrator.stop();
      const nextReady = start();
      readyPromise = nextReady;
      await nextReady;
    })().finally(() => {
      refreshPromise = null;
    });
    return refreshPromise;
  };

  void ensureReady();

  return {
    orchestrator,
    waitForReady: ensureReady,
    refresh,
  };
}
