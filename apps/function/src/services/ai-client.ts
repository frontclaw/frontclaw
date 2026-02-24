import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import {
  createAIClient,
  createAIRuntimeManager,
  getConfigPath,
  getConfigs,
  type AIClientConfig,
  type AIClientInstance,
} from "@workspace/core";
import type { Chat, FrontClawSchema } from "@workspace/schema";
import { createOllama } from "ollama-ai-provider-v2";

const runtime = createAIRuntimeManager({
  initialClient: createAIClient({
    debug: process.env.NODE_ENV === "development",
  }),
  initialize: async () => {
    const configPath = getConfigPath();
    if (!configPath) {
      throw new Error(
        "Config path not found, please set CONFIG_PATH or FRONTCLAW_CONFIG_PATH environment variable",
      );
    }
    const configs = (await getConfigs(configPath)) as FrontClawSchema;
    const chatConfig = configs.ai_models?.chat;

    const configuredSystemPrompt =
      typeof chatConfig?.system_prompt === "string"
        ? chatConfig.system_prompt.trim()
        : "";

    if (!chatConfig?.provider || !chatConfig.model || !chatConfig.api_key) {
      throw new Error(
        "frontclaw.json missing ai_models.chat.provider/model/api_key",
      );
    }

    const model = createProviderModel(chatConfig);
    return {
      client: createAIClient({
        model,
        debug: process.env.NODE_ENV === "development",
      }),
      configuredSystemPrompt,
    };
  },
  autoInitialize: true,
});

export { type AIClientInstance };

export function waitForAIReady(): Promise<void> {
  return runtime.waitForReady();
}

export async function reloadAIClient(): Promise<void> {
  await runtime.reload();
}

export function getAIClient(): AIClientInstance {
  return runtime.getClient();
}

export function getConfiguredSystemPrompt(): string {
  return runtime.getConfiguredSystemPrompt();
}

function createProviderModel(config: Chat): NonNullable<AIClientConfig["model"]> {
  switch (config.provider) {
    case "openai": {
      const openai = createOpenAI({
        apiKey: config.api_key,
        baseURL: config.base_url,
        name: "openai",
      });
      return openai(config.model!);
    }
    case "anthropic": {
      const anthropic = createAnthropic({
        apiKey: config.api_key,
        baseURL: config.base_url,
      });
      return anthropic(config.model!);
    }
    case "google": {
      const google = createGoogleGenerativeAI({
        apiKey: config.api_key,
        baseURL: config.base_url,
      });
      return google(config.model!);
    }
    case "ollama": {
      const ollama = createOllama({
        name: "ollama",
        baseURL: config.base_url,
      });
      return ollama(config.model!) as unknown as NonNullable<
        AIClientConfig["model"]
      >;
    }
    case "lmstudio": {
      const lmstudio = createOpenAICompatible({
        name: "lmstudio",
        baseURL: config.base_url!,
      });
      return lmstudio(config.model!);
    }
    default:
      throw new Error(`Unsupported chat provider: ${config.provider}`);
  }
}
