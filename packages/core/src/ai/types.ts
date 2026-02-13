/**
 * AI Types
 * Provider-agnostic types (models supplied by AI SDK)
 */

import { z } from "zod";

/** Chat message role */
export const ChatRoleSchema = z.enum(["system", "user", "assistant", "tool"]);
export type ChatRole = z.infer<typeof ChatRoleSchema>;

/** Chat message schema */
export const ChatMessageSchema = z.object({
  role: ChatRoleSchema,
  content: z.string(),
  /** Tool call ID (for tool messages) */
  toolCallId: z.string().optional(),
  /** Tool name (for tool messages) */
  toolName: z.string().optional(),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

/** Tool parameter schema */
export const ToolParameterSchema = z.object({
  type: z.string(),
  description: z.string().optional(),
  enum: z.array(z.string()).optional(),
});
export type ToolParameter = z.infer<typeof ToolParameterSchema>;

/** Tool definition schema */
export const ToolDefinitionSchema = z.object({
  name: z.string(),
  description: z.string(),
  parameters: z.object({
    type: z.literal("object"),
    properties: z.record(ToolParameterSchema),
    required: z.array(z.string()).optional(),
  }),
});
export type ToolDefinition = z.infer<typeof ToolDefinitionSchema>;

/** Tool call from LLM */
export const ToolCallSchema = z.object({
  id: z.string(),
  name: z.string(),
  arguments: z.record(z.unknown()),
});
export type ToolCall = z.infer<typeof ToolCallSchema>;

/** Tool result to send back */
export const ToolResultSchema = z.object({
  toolCallId: z.string(),
  toolName: z.string(),
  result: z.unknown(),
});
export type ToolResult = z.infer<typeof ToolResultSchema>;

/** Chat completion options */
export interface ChatCompletionOptions {
  /** Messages to send */
  messages: ChatMessage[];
  /** System prompt (prepended to messages) */
  systemPrompt?: string;
  /** Available tools */
  tools?: ToolDefinition[];
  /** Tool choice mode */
  toolChoice?: "auto" | "none" | "required" | { name: string };
  /** Tool executor (invoked when model calls tools) */
  toolExecutor?: (
    toolName: string,
    args: Record<string, unknown>,
  ) => Promise<unknown>;
  /** Override temperature */
  temperature?: number;
  /** Override max tokens */
  maxTokens?: number;
  /** Stop sequences */
  stopSequences?: string[];
}

/** Chat completion result */
export interface ChatCompletionResult {
  /** Generated text content */
  content: string;
  /** Tool calls requested by the model */
  toolCalls: ToolCall[];
  /** Finish reason */
  finishReason: "stop" | "length" | "tool-calls" | "content-filter" | "other";
  /** Token usage */
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

/** Streaming chunk */
export interface StreamChunk {
  /** Text delta */
  textDelta?: string;
  /** Tool call delta */
  toolCallDelta?: {
    id: string;
    name?: string;
    arguments?: string;
  };
  /** Is this the final chunk? */
  isComplete: boolean;
}

/** Embedding options */
export interface EmbeddingOptions {
  /** Text to embed */
  text: string | string[];
  /** Dimensions (for models that support it) */
  dimensions?: number;
}

/** Embedding result */
export interface EmbeddingResult {
  /** Embedding vectors */
  embeddings: number[][];
  /** Token usage */
  usage: {
    promptTokens: number;
    totalTokens: number;
  };
}

/** Structured output options */
export interface StructuredOutputOptions<T extends z.ZodType> {
  /** Messages to send */
  messages: ChatMessage[];
  /** System prompt */
  systemPrompt?: string;
  /** Zod schema for output */
  schema: T;
  /** Schema name (for OpenAI) */
  schemaName?: string;
  /** Schema description */
  schemaDescription?: string;
}
