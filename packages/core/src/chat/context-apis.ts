import {
  buildConversationMetrics,
  loadContextCompactionConfigFromDisk,
  parsePagingValue,
  toContextMessages,
  toConversationHistoryMessages,
} from "../context/management.js";
import { toLLMMessages, toTextContent } from "./pipeline.js";
import { buildFinalSystemPrompt, runConversationCompaction } from "./service.js";

type ConversationRecord = {
  id: string;
};

type MessageRecord = {
  id: string;
  role: string;
  content: string;
};

type PipelineError = {
  message?: string;
  code?: string;
  pluginId?: string;
};

type CommonDeps = {
  awaitOrchestratorReady: () => Promise<void>;
  awaitAIReady: () => Promise<void>;
  getConfiguredSystemPrompt: () => string;
  getAIClient: () => {
    chat: (options: any) => Promise<{ content: string }>;
  };
  db: {
    getConversation: (id: string) => Promise<ConversationRecord | null>;
    getMessages: (
      conversationId: string,
      options?: { limit?: number; offset?: number },
    ) => Promise<MessageRecord[]>;
    createMessage: (value: {
      conversationId: string;
      role: string;
      content: string;
      metadata?: Record<string, unknown>;
    }) => Promise<{ id?: string; content: string } | null>;
    deleteMessagesByIds: (
      conversationId: string,
      messageIds: string[],
    ) => Promise<number>;
    touchConversation: (conversationId: string) => Promise<void>;
  };
  orchestrator: {
    collectTools: () => Promise<
      Array<{
        name: string;
        description?: string;
        parameters?: {
          properties?: Record<string, unknown>;
          required?: string[];
        };
      }>
    >;
    collectSkills: () => Promise<
      Array<{
        name: string;
        description?: string;
        inputSchema: {
          properties: Record<string, unknown>;
          required?: string[];
        };
      }>
    >;
    transformSystemMessage: (input: string) => Promise<string>;
    processPrompt: (message: string) => Promise<{
      success: boolean;
      result?: unknown;
      interceptedBy?: string;
      error?: PipelineError;
    }>;
    beforeLLMCall: (messages: any[]) => Promise<{
      success: boolean;
      result?: any[];
      interceptedBy?: string;
      error?: PipelineError;
    }>;
  };
};

export async function executeConversationContextRequest(params: {
  conversationId: string;
  query: { limit?: string; message?: string; systemPrompt?: string };
  deps: CommonDeps;
}): Promise<{ status: number; body: Record<string, unknown> }> {
  const { conversationId, query, deps } = params;
  await deps.awaitOrchestratorReady();
  await deps.awaitAIReady();

  const conversation = await deps.db.getConversation(conversationId);
  if (!conversation) {
    return {
      status: 404,
      body: { success: false, message: "Conversation not found" },
    };
  }

  const limit = parsePagingValue(query.limit, 100);
  const requestedMessage = (query.message || "").trim();
  const additionalSystemPrompt = (query.systemPrompt || "").trim();

  const historyRows = await deps.db.getMessages(conversation.id, { limit });
  const historyRowsForCore = toContextMessages(historyRows);
  const contextCompactionConfig = await loadContextCompactionConfigFromDisk();

  const tools = await deps.orchestrator.collectTools();
  const skills = await deps.orchestrator.collectSkills();
  const finalSystemPrompt = await buildFinalSystemPrompt({
    configuredSystemPrompt: deps.getConfiguredSystemPrompt(),
    additionalSystemPrompt,
    tools,
    skills,
    transformSystemMessage: async (input) =>
      await deps.orchestrator.transformSystemMessage(input),
  });

  let promptResult:
    | { success: true; content: string; interceptedBy?: string }
    | { success: false; code?: string; message: string; blockedBy?: string }
    | null = null;

  let userMessageForContext = requestedMessage;
  if (requestedMessage) {
    const processedPrompt = await deps.orchestrator.processPrompt(requestedMessage);
    if (!processedPrompt.success) {
      return {
        status: 403,
        body: {
          success: false,
          message: processedPrompt.error?.message || "Prompt processing failed",
          code: processedPrompt.error?.code,
          blockedBy: processedPrompt.error?.pluginId,
          conversationId: conversation.id,
        },
      };
    }
    userMessageForContext = toTextContent(processedPrompt.result || requestedMessage);
    promptResult = {
      success: true,
      content: userMessageForContext,
      interceptedBy: processedPrompt.interceptedBy || undefined,
    };
  }

  const { historyMessages, metrics } = buildConversationMetrics({
    historyRows: historyRowsForCore,
    requestedMessage: userMessageForContext,
    finalSystemPrompt,
    config: contextCompactionConfig,
  });

  const pipelineMessages = [
    { role: "system" as const, content: finalSystemPrompt },
    ...historyMessages,
    ...(userMessageForContext
      ? [{ role: "user" as const, content: userMessageForContext }]
      : []),
  ];

  const llmCallResult = await deps.orchestrator.beforeLLMCall(pipelineMessages);
  if (!llmCallResult.success) {
    return {
      status: 403,
      body: {
        success: false,
        message: llmCallResult.error?.message || "LLM call blocked",
        code: llmCallResult.error?.code,
        blockedBy: llmCallResult.error?.pluginId,
        conversationId: conversation.id,
      },
    };
  }

  const llmMessages = toLLMMessages(llmCallResult.result || pipelineMessages);
  return {
    status: 200,
    body: {
      success: true,
      conversationId: conversation.id,
      context: {
        systemPrompt: finalSystemPrompt,
        historyCount: historyMessages.length,
        historyMessages,
        pipelineMessages,
        llmMessages,
        toolCount: tools.length,
        skillCount: skills.length,
        promptInterceptedBy: promptResult?.success
          ? promptResult.interceptedBy
          : undefined,
        llmInterceptedBy: llmCallResult.interceptedBy || undefined,
        metrics,
      },
    },
  };
}

export async function executeConversationMetricsRequest(params: {
  conversationId: string;
  query: { limit?: string; message?: string; systemPrompt?: string };
  deps: CommonDeps;
}): Promise<{ status: number; body: Record<string, unknown> }> {
  const { conversationId, query, deps } = params;
  await deps.awaitOrchestratorReady();
  await deps.awaitAIReady();

  const conversation = await deps.db.getConversation(conversationId);
  if (!conversation) {
    return {
      status: 404,
      body: { success: false, message: "Conversation not found" },
    };
  }

  const contextCompactionConfig = await loadContextCompactionConfigFromDisk();
  const limit = parsePagingValue(
    query.limit,
    Math.max(300, contextCompactionConfig.preserveRecentMessages * 20),
  );
  const requestedMessage = (query.message || "").trim();
  const additionalSystemPrompt = (query.systemPrompt || "").trim();

  const historyRows = await deps.db.getMessages(conversation.id, { limit });
  const historyRowsForCore = toContextMessages(historyRows);

  const tools = await deps.orchestrator.collectTools();
  const skills = await deps.orchestrator.collectSkills();
  const finalSystemPrompt = await buildFinalSystemPrompt({
    configuredSystemPrompt: deps.getConfiguredSystemPrompt(),
    additionalSystemPrompt,
    tools,
    skills,
    transformSystemMessage: async (input) =>
      await deps.orchestrator.transformSystemMessage(input),
  });

  const { metrics } = buildConversationMetrics({
    historyRows: historyRowsForCore,
    requestedMessage,
    finalSystemPrompt,
    config: contextCompactionConfig,
  });

  return {
    status: 200,
    body: {
      success: true,
      conversationId: conversation.id,
      metrics,
    },
  };
}

export async function executeConversationCompactionRequest(params: {
  conversationId: string;
  body?: { force?: boolean; preserveRecentMessages?: number };
  deps: CommonDeps;
}): Promise<{ status: number; body: Record<string, unknown> }> {
  const { conversationId, body, deps } = params;
  await deps.awaitOrchestratorReady();
  await deps.awaitAIReady();

  const conversation = await deps.db.getConversation(conversationId);
  if (!conversation) {
    return {
      status: 404,
      body: { success: false, message: "Conversation not found" },
    };
  }

  const config = await loadContextCompactionConfigFromDisk();
  if (
    typeof body?.preserveRecentMessages === "number" &&
    Number.isFinite(body.preserveRecentMessages)
  ) {
    config.preserveRecentMessages = Math.max(
      2,
      Math.floor(body.preserveRecentMessages),
    );
  }

  const rows = await deps.db.getMessages(conversation.id, {
    limit: Math.max(300, config.preserveRecentMessages * 20),
  });
  const result = await runConversationCompaction({
    messages: toContextMessages(rows),
    config,
    reason: "manual",
    force: body?.force ?? true,
    summarize: async (transcript) => {
      const summary = await deps.getAIClient().chat({
        messages: [
          {
            role: "system",
            content:
              "You compress long chat history into a concise memory block for future turns. Capture user goals, constraints, preferences, key facts, and unresolved tasks. Keep it factual, no assumptions.",
          },
          {
            role: "user",
            content: `Summarize this conversation history for context carryover:\n\n${transcript}`,
          },
        ],
        toolChoice: "none",
      });
      return summary.content || "";
    },
    persistSummaryMessage: async ({
      summaryText,
      targetAfterTokens,
      compactedMessageCount,
      reason,
    }) =>
      await deps.db.createMessage({
        conversationId: conversation.id,
        role: "system",
        content: `[Context checkpoint]\n${summaryText}`,
        metadata: {
          type: "context_compaction_summary",
          reason,
          compactedMessageCount,
          targetAfterTokens,
          createdAt: new Date().toISOString(),
        },
      }),
    deleteMessagesByIds: async (messageIds) =>
      await deps.db.deleteMessagesByIds(conversation.id, messageIds),
    touchConversation: async () => {
      await deps.db.touchConversation(conversation.id);
    },
  });

  return {
    status: 200,
    body: {
      success: true,
      conversationId: conversation.id,
      compacted: result.compacted,
      result,
    },
  };
}
