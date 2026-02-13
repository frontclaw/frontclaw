/**
 * AI Client
 * Main interface for interacting with AI models
 */

import {
  generateText,
  streamText,
  generateObject,
  embed,
  embedMany,
  type LanguageModel,
  type EmbeddingModel,
} from "ai";
import { z } from "zod";
import { convertMessages } from "./converters/messages.js";
import { convertTools } from "./converters/tools.js";
import type {
  ChatCompletionOptions,
  ChatCompletionResult,
  StreamChunk,
  ToolCall,
  EmbeddingOptions,
  EmbeddingResult,
  StructuredOutputOptions,
} from "./types.js";

/**
 * AI Client Configuration
 */
export interface AIClientConfig {
  /** Language model instance (from AI SDK provider) */
  model?: LanguageModel;
  /** Embedding model instance (from AI SDK provider) */
  embeddingModel?: EmbeddingModel<string>;
  /** Enable debug logging */
  debug?: boolean;
}

/**
 * AIClient
 * Provides a unified interface for AI operations
 */
export class AIClient {
  private config: AIClientConfig;

  constructor(config: AIClientConfig = {}) {
    this.config = config;
  }

  /**
   * Get the configured model (required)
   */
  private getModel(): LanguageModel {
    if (!this.config.model) {
      throw new Error(
        "AIClient requires a model instance. Provide config.model from an AI SDK provider.",
      );
    }
    return this.config.model;
  }

  /**
   * Generate a chat completion
   */
  async chat(options: ChatCompletionOptions): Promise<ChatCompletionResult> {
    const model = this.getModel();

    // Prepare messages
    let messages = [...options.messages];
    if (options.systemPrompt) {
      messages = [
        { role: "system", content: options.systemPrompt },
        ...messages,
      ];
    }

    // Prepare tools if any
    const tools = options.tools
      ? convertTools(options.tools, options.toolExecutor)
      : undefined;

    if (this.config.debug) {
      console.log("[AIClient] Generating text with:", {
        messageCount: messages.length,
        toolCount: options.tools?.length || 0,
      });
    }

    const result = await generateText({
      model,
      messages: convertMessages(messages),
      tools,
      toolChoice: options.toolChoice as Parameters<
        typeof generateText
      >[0]["toolChoice"],
      temperature: options.temperature,
      maxTokens: options.maxTokens,
      stopSequences: options.stopSequences,
    });

    // Extract tool calls
    const toolCalls: ToolCall[] =
      result.toolCalls?.map((tc) => ({
        id: tc.toolCallId,
        name: tc.toolName,
        arguments: tc.args as Record<string, unknown>,
      })) || [];

    return {
      content: result.text,
      toolCalls,
      finishReason: result.finishReason as ChatCompletionResult["finishReason"],
      usage: {
        promptTokens: result.usage.promptTokens,
        completionTokens: result.usage.completionTokens,
        totalTokens: result.usage.totalTokens,
      },
    };
  }

  /**
   * Stream a chat completion
   */
  async *chatStream(
    options: ChatCompletionOptions,
  ): AsyncGenerator<StreamChunk, ChatCompletionResult> {
    const model = this.getModel();

    // Prepare messages
    let messages = [...options.messages];
    if (options.systemPrompt) {
      messages = [
        { role: "system", content: options.systemPrompt },
        ...messages,
      ];
    }

    // Prepare tools if any
    const tools = options.tools
      ? convertTools(options.tools, options.toolExecutor)
      : undefined;

    const streamResult = streamText({
      model,
      messages: convertMessages(messages),
      tools,
      toolChoice: options.toolChoice as Parameters<
        typeof streamText
      >[0]["toolChoice"],
      temperature: options.temperature,
      maxTokens: options.maxTokens,
      stopSequences: options.stopSequences,
    });

    // Collect for final result
    let fullText = "";
    const toolCalls: ToolCall[] = [];

    for await (const chunk of streamResult.textStream) {
      fullText += chunk;
      yield {
        textDelta: chunk,
        isComplete: false,
      };
    }

    // Get final values
    const finishReason = await streamResult.finishReason;
    const usage = await streamResult.usage;
    const finalToolCalls = await streamResult.toolCalls;

    // Extract tool calls from final result
    if (finalToolCalls) {
      for (const tc of finalToolCalls) {
        toolCalls.push({
          id: tc.toolCallId,
          name: tc.toolName,
          arguments: tc.args as Record<string, unknown>,
        });
      }
    }

    // Yield final chunk
    yield {
      isComplete: true,
    };

    return {
      content: fullText,
      toolCalls,
      finishReason: finishReason as ChatCompletionResult["finishReason"],
      usage: {
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        totalTokens: usage.totalTokens,
      },
    };
  }

  /**
   * Generate structured output with a Zod schema
   */
  async generateStructured<T extends z.ZodType>(
    options: StructuredOutputOptions<T>,
  ): Promise<{ data: z.infer<T>; usage: ChatCompletionResult["usage"] }> {
    const model = this.getModel();

    // Prepare messages
    let messages = [...options.messages];
    if (options.systemPrompt) {
      messages = [
        { role: "system", content: options.systemPrompt },
        ...messages,
      ];
    }

    if (this.config.debug) {
      console.log("[AIClient] Generating structured output with:", {
        schemaName: options.schemaName,
      });
    }

    const result = await generateObject({
      model,
      messages: convertMessages(messages),
      schema: options.schema,
      schemaName: options.schemaName,
      schemaDescription: options.schemaDescription,
    });

    return {
      data: result.object,
      usage: {
        promptTokens: result.usage.promptTokens,
        completionTokens: result.usage.completionTokens,
        totalTokens: result.usage.totalTokens,
      },
    };
  }

  /**
   * Generate embeddings for text
   */
  async embed(options: EmbeddingOptions): Promise<EmbeddingResult> {
    if (!this.config.embeddingModel) {
      throw new Error(
        "AIClient requires an embedding model instance. Provide config.embeddingModel from an AI SDK provider.",
      );
    }
    const embeddingModel = this.config.embeddingModel;

    if (Array.isArray(options.text)) {
      const result = await embedMany({
        model: embeddingModel,
        values: options.text,
      });

      return {
        embeddings: result.embeddings,
        usage: {
          promptTokens: result.usage.tokens,
          totalTokens: result.usage.tokens,
        },
      };
    } else {
      const result = await embed({
        model: embeddingModel,
        value: options.text,
      });

      return {
        embeddings: [result.embedding],
        usage: {
          promptTokens: result.usage.tokens,
          totalTokens: result.usage.tokens,
        },
      };
    }
  }

  /**
   * Simple text generation helper
   */
  async generate(
    prompt: string,
    options?: Partial<ChatCompletionOptions>,
  ): Promise<string> {
    const result = await this.chat({
      messages: [{ role: "user", content: prompt }],
      ...options,
    });
    return result.content;
  }

  /**
   * Update configuration
   */
  configure(config: Partial<AIClientConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

/**
 * Create a new AI client instance
 */
export function createAIClient(config?: AIClientConfig): AIClient {
  return new AIClient(config);
}

/**
 * Default AI client instance
 */
export const defaultAIClient = new AIClient();
