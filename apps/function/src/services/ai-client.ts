import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createAIClient, getConfigPath, getConfigs } from "@workspace/core";
import type { Chat, Embeddings, FrontClawSchema } from "@workspace/schema";

export type AIClientInstance = ReturnType<typeof createAIClient>;

let aiClient = createAIClient({ debug: process.env.NODE_ENV === "development" });

export const aiReady = (async () => {
  const configPath = getConfigPath();
  if (!configPath) {
    throw new Error(
      "Config path not found, please set CONFIG_PATH or FRONTCLAW_CONFIG_PATH environment variable",
    );
  }
  const configs = (await getConfigs(configPath)) as FrontClawSchema;
  const chatConfig = configs.ai_models?.chat;
  const embeddingConfig = configs.ai_models?.embeddings;

  if (!chatConfig?.provider || !chatConfig.model || !chatConfig.api_key) {
    throw new Error(
      "frontclaw.json missing ai_models.chat.provider/model/api_key",
    );
  }

  const model = createProviderModel(chatConfig);
  const embeddingModel = embeddingConfig
    ? createEmbeddingModel(embeddingConfig)
    : undefined;

  aiClient = createAIClient({
    model,
    embeddingModel,
    debug: process.env.NODE_ENV === "development",
  });
})();

export function getAIClient(): AIClientInstance {
  return aiClient;
}

function createProviderModel(config: Chat) {
  switch (config.provider) {
    case "openai": {
      const openai = createOpenAI({
        apiKey: config.api_key,
        baseURL: config.base_url,
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
    default:
      throw new Error(`Unsupported chat provider: ${config.provider}`);
  }
}

function createEmbeddingModel(config: Embeddings) {
  if (!config.provider || !config.model || !config.api_key) {
    throw new Error(
      "frontclaw.json missing ai_models.embeddings.provider/model/api_key",
    );
  }
  switch (config.provider) {
    case "openai": {
      const openai = createOpenAI({
        apiKey: config.api_key,
        baseURL: config.base_url,
      });
      return openai.embedding(config.model);
    }
    case "google": {
      const google = createGoogleGenerativeAI({
        apiKey: config.api_key,
        baseURL: config.base_url,
      });
      return google.textEmbeddingModel(config.model);
    }
    default:
      throw new Error(`Unsupported embedding provider: ${config.provider}`);
  }
}
