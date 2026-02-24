import {
  compactConversationContext,
  type ContextCompactionResult,
  type ContextCompactionRuntimeConfig,
  type ContextMessage,
} from "../context/management.js";
import { buildToolContext } from "./pipeline.js";
import type { ToolDefinition } from "../ai/types.js";

export const DEFAULT_PERSONALITY_SYSTEM_PROMPT = [
  "You are Frontclaw AI, a practical and reliable assistant.",
  "Prioritize accurate, safe, and actionable responses.",
  "Be concise by default, but provide details when explicitly requested or when complexity requires it.",
  "If tools are available and needed for current information, call them and use their outputs.",
].join(" ");

export async function buildFinalSystemPrompt(params: {
  configuredSystemPrompt?: string;
  additionalSystemPrompt?: string;
  tools: Array<{
    name: string;
    description?: string;
    parameters?: {
      properties?: Record<string, unknown>;
      required?: string[];
    };
  }>;
  skills: Array<{
    name: string;
    description?: string;
    inputSchema?: {
      properties?: Record<string, unknown>;
      required?: string[];
    };
  }>;
  transformSystemMessage: (input: string) => Promise<string>;
}): Promise<string> {
  const personalitySystemPrompt =
    params.configuredSystemPrompt || DEFAULT_PERSONALITY_SYSTEM_PROMPT;
  const trimmedAdditional = (params.additionalSystemPrompt || "").trim();
  const baseSystemPrompt = trimmedAdditional
    ? `${personalitySystemPrompt}\n\nAdditional system instructions:\n${trimmedAdditional}`
    : personalitySystemPrompt;
  const transformedSystemPrompt =
    await params.transformSystemMessage(baseSystemPrompt);
  const toolContext = buildToolContext(params.tools, params.skills);
  return toolContext
    ? `${transformedSystemPrompt}\n\n${toolContext}`
    : transformedSystemPrompt;
}

export function buildAIToolDefinitions(
  tools: Array<{
    name: string;
    description?: string;
    parameters?: {
      properties?: Record<string, unknown>;
      required?: string[];
    };
  }>,
  skills: Array<{
    name: string;
    description?: string;
    inputSchema: {
      properties: Record<string, unknown>;
      required?: string[];
    };
  }>,
): {
  aiTools: ToolDefinition[];
  aiSkills: ToolDefinition[];
  mergedTools?: ToolDefinition[];
} {
  const aiTools: ToolDefinition[] = tools.map((t) => ({
    name: t.name,
    description: t.description || "",
    parameters: {
      type: "object" as const,
      properties: t.parameters?.properties || {},
      required: t.parameters?.required,
    },
  }));

  const aiSkills: ToolDefinition[] = skills.map((s) => ({
    name: s.name,
    description: s.description || "",
    parameters: {
      type: "object" as const,
      properties: s.inputSchema.properties || {},
      required: s.inputSchema.required,
    },
  }));

  return {
    aiTools,
    aiSkills,
    mergedTools:
      aiTools.length > 0 || aiSkills.length > 0 ? [...aiTools, ...aiSkills] : undefined,
  };
}

export async function runConversationCompaction(params: {
  messages: ContextMessage[];
  config: ContextCompactionRuntimeConfig;
  reason: "auto" | "manual";
  force?: boolean;
  retainMessageIds?: string[];
  summarize: (transcript: string) => Promise<string>;
  persistSummaryMessage: (payload: {
    summaryText: string;
    targetAfterTokens: number;
    compactedMessageCount: number;
    reason: "auto" | "manual";
  }) => Promise<{ id?: string; content: string } | null>;
  deleteMessagesByIds: (messageIds: string[]) => Promise<number>;
  touchConversation: () => Promise<void>;
}): Promise<ContextCompactionResult> {
  return await compactConversationContext({
    messages: params.messages,
    config: params.config,
    reason: params.reason,
    force: params.force,
    retainMessageIds: params.retainMessageIds,
    summarizeTranscript: params.summarize,
    persistSummaryMessage: params.persistSummaryMessage,
    deleteMessagesByIds: params.deleteMessagesByIds,
    touchConversation: params.touchConversation,
  });
}
