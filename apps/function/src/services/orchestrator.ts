import {
  Orchestrator,
  RedisMemoryService,
  SecureMemoryService,
  type OrchestratorConfig,
} from "@workspace/core";
import path from "node:path";
import { getAIClient } from "./ai-client";
import { createPluginSystemLogger, createScopedLogger } from "../lib/logging";

function parseKey(value: string): Buffer {
  const trimmed = value.trim();
  const isHex = /^[0-9a-fA-F]+$/.test(trimmed);
  const buf = isHex ? Buffer.from(trimmed, "hex") : Buffer.from(trimmed, "base64");
  if (buf.length !== 32) {
    throw new Error("MEMORY_ENCRYPTION_KEY must be 32 bytes (hex or base64)");
  }
  return buf;
}

const memoryService = process.env.REDIS_URL
  ? new RedisMemoryService({
      url: process.env.REDIS_URL,
      namespace: process.env.MEMORY_NAMESPACE,
    })
  : undefined;

const secureMemoryService =
  memoryService && process.env.MEMORY_ENCRYPTION_KEY
    ? new SecureMemoryService(memoryService, {
        encryptionKey: parseKey(process.env.MEMORY_ENCRYPTION_KEY),
        signingKey: process.env.MEMORY_SIGNING_KEY
          ? parseKey(process.env.MEMORY_SIGNING_KEY)
          : undefined,
      })
    : memoryService;

const appLogger = createScopedLogger("orchestrator");
const pluginLogger = createPluginSystemLogger();

const orchestratorConfig: OrchestratorConfig = {
  loader: {
    pluginsDir: path.resolve(import.meta.dirname, "../../../../plugins"),
    pluginConfigs: {
      // Override plugin configs here if needed
    },
    disabledPlugins: [],
  },
  dependencies: {
    logger: pluginLogger,
    llm: {
      async chat(options) {
        const aiClient = getAIClient();
        const result = await aiClient.chat({
          messages: options.messages,
          systemPrompt: options.systemPrompt,
          maxTokens: options.maxTokens,
          temperature: options.temperature,
        });
        return {
          content: result.content,
          usage: result.usage,
        };
      },
    },
  },
  memoryService: secureMemoryService,
  hookTimeout: 5000,
};

export const orchestrator = new Orchestrator(orchestratorConfig);
let orchestratorReadyPromise: Promise<void> | null = null;
let orchestratorRefreshPromise: Promise<void> | null = null;

function startOrchestrator(): Promise<void> {
  return orchestrator
    .start()
    .then(() => {
      appLogger.info("Frontclaw Orchestrator started successfully", undefined, {
        essential: true,
      });
    })
    .catch((error) => {
      appLogger.error("Failed to start Frontclaw Orchestrator", error);
      throw error;
    });
}

function ensureOrchestratorReadyPromise(): Promise<void> {
  if (!orchestratorReadyPromise) {
    orchestratorReadyPromise = startOrchestrator();
  }
  return orchestratorReadyPromise;
}

export function waitForOrchestratorReady(): Promise<void> {
  return ensureOrchestratorReadyPromise();
}

export async function refreshOrchestrator(): Promise<void> {
  if (orchestratorRefreshPromise) {
    return orchestratorRefreshPromise;
  }

  orchestratorRefreshPromise = (async () => {
    await orchestrator.stop();
    const nextReady = startOrchestrator();
    orchestratorReadyPromise = nextReady;
    await nextReady;
  })().finally(() => {
    orchestratorRefreshPromise = null;
  });

  return orchestratorRefreshPromise;
}

ensureOrchestratorReadyPromise();
