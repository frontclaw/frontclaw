import {
  estimateMessagesTokens,
  loadContextCompactionConfigFromDisk,
  toContextMessages,
  toConversationHistoryMessages,
  type ContextCompactionResult,
} from "../context/management.js";
import {
  buildAIToolDefinitions,
  buildFinalSystemPrompt,
  runConversationCompaction,
} from "./service.js";
import {
  createToolExecutor,
  deriveConversationTitle,
  fallbackFromToolResults,
  hasConversationTitle,
  toLLMMessages,
  toTextContent,
  type ExecutedToolContext,
  type PersistedToolEvent,
  ToolTerminalResponseError,
  wantsStream,
} from "./pipeline.js";
import {
  appendSSESessionEvent,
  closeSSESession,
  createSSESession,
  createSSESessionReadable,
} from "../stream/sse-session-store.js";

export type ChatRequestBody = {
  message: string;
  systemPrompt?: string;
  conversationId?: string;
  profileId?: string;
  title?: string;
  stream?: boolean;
};

type ConversationRecord = {
  id: string;
  profileId?: string | null;
  title?: string | null;
  metadata?: unknown;
};

type MessageRecord = {
  id: string;
  conversationId: string;
  role: string;
  content: string;
  toolName?: string | null;
  toolCallId?: string | null;
  metadata?: unknown;
};

type ChatPipelineError = {
  message?: string;
  code?: string;
  pluginId?: string;
};

export type ChatExecutionDeps = {
  awaitOrchestratorReady: () => Promise<void>;
  awaitAIReady: () => Promise<void>;
  getAIClient: () => {
    chat: (options: any) => Promise<{
      content: string;
      toolCalls: Array<{
        id: string;
        name: string;
        arguments: Record<string, unknown>;
      }>;
    }>;
    chatStream: (options: any) => AsyncIterable<{
      textDelta?: string;
      content?: string;
      toolCalls?: Array<{
        id: string;
        name: string;
        arguments: Record<string, unknown>;
      }>;
    }>;
  };
  getConfiguredSystemPrompt: () => string;
  orchestrator: {
    processPrompt: (message: string) => Promise<{
      success: boolean;
      result?: unknown;
      interceptedBy?: string;
      error?: ChatPipelineError;
    }>;
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
    beforeLLMCall: (messages: any[]) => Promise<{
      success: boolean;
      result?: any[];
      interceptedBy?: string;
      error?: ChatPipelineError;
    }>;
    afterLLMCall: (value: string) => Promise<string>;
    executeSkill: (
      toolName: string,
      args: Record<string, unknown>,
    ) => Promise<{ success: boolean; result?: unknown }>;
    executeTool: (
      toolName: string,
      args: Record<string, unknown>,
      options: { source: "llm" },
    ) => Promise<{ success: boolean; result?: unknown; error?: string }>;
  };
  db: {
    getConversation: (id: string) => Promise<ConversationRecord | null>;
    createConversation: (value: {
      profileId?: string;
      title?: string;
      metadata?: Record<string, unknown>;
    }) => Promise<ConversationRecord | null>;
    getMessages: (
      conversationId: string,
      options?: { limit?: number; offset?: number },
    ) => Promise<MessageRecord[]>;
    createMessage: (value: {
      conversationId: string;
      role: string;
      content: string;
      toolName?: string | null;
      toolCallId?: string | null;
      metadata?: Record<string, unknown>;
    }) => Promise<MessageRecord | null>;
    touchConversation: (conversationId: string) => Promise<void>;
    setConversationTitle: (conversationId: string, title: string) => Promise<void>;
    deleteMessagesByIds: (
      conversationId: string,
      messageIds: string[],
    ) => Promise<number>;
  };
  logger: {
    debug: (message: string, meta?: unknown) => void;
    info: (message: string, meta?: unknown, options?: { essential?: boolean }) => void;
    warn: (message: string, meta?: unknown) => void;
    error: (message: string, meta?: unknown) => void;
  };
};

export type ChatExecutionResult =
  | { kind: "stream"; stream: ReadableStream<Uint8Array> }
  | { kind: "json"; status: number; body: Record<string, unknown> };

export async function executeChatRequest(params: {
  body: Partial<ChatRequestBody>;
  acceptHeader?: string;
  deps: ChatExecutionDeps;
}): Promise<ChatExecutionResult> {
  const { body, acceptHeader, deps } = params;
  const chatLogger = deps.logger;
  chatLogger.info("Incoming chat request", undefined, { essential: true });
  await deps.awaitOrchestratorReady();
  await deps.awaitAIReady();
  chatLogger.debug("Dependencies ready");
  const contextCompactionConfig = await loadContextCompactionConfigFromDisk();

  const message = typeof body.message === "string" ? body.message.trim() : "";
  chatLogger.debug("Parsed request payload", {
    hasConversationId: !!body.conversationId,
    messageLength: message.length,
    stream: body.stream === true,
  });

  if (!message) {
    return {
      kind: "json",
      status: 400,
      body: { success: false, message: "Message is required" },
    };
  }

  let conversation = body.conversationId
    ? await deps.db.getConversation(body.conversationId)
    : await deps.db.createConversation({
        profileId: body.profileId,
        title: body.title || deriveConversationTitle(message),
        metadata: {},
      });

  if (!conversation) {
    return {
      kind: "json",
      status: 404,
      body: { success: false, message: "Conversation not found" },
    };
  }

  const historyFetchLimit = Math.max(
    300,
    contextCompactionConfig.preserveRecentMessages * 20,
  );
  let historyRows = await deps.db.getMessages(conversation.id, {
    limit: historyFetchLimit,
  });
  let historyMessages = toConversationHistoryMessages(toContextMessages(historyRows));

  const userMessage = await deps.db.createMessage({
    conversationId: conversation.id,
    role: "user",
    content: message,
  });
  await deps.db.touchConversation(conversation.id);

  const promptResult = await deps.orchestrator.processPrompt(message);
  chatLogger.debug("Prompt pipeline result", {
    success: promptResult.success,
    interceptedBy: promptResult.interceptedBy,
  });

  if (!hasConversationTitle(conversation.title)) {
    const promptForTitle =
      promptResult.success && promptResult.result
        ? toTextContent(promptResult.result)
        : message;
    const title = deriveConversationTitle(promptForTitle);
    await deps.db.setConversationTitle(conversation.id, title);
    conversation = {
      ...conversation,
      title,
    };
  }

  if (!promptResult.success) {
    return {
      kind: "json",
      status: 403,
      body: {
        success: false,
        message: promptResult.error?.message || "Prompt processing failed",
        code: promptResult.error?.code,
        blockedBy: promptResult.error?.pluginId,
        conversationId: conversation.id,
        messageId: userMessage?.id,
      },
    };
  }

  if (promptResult.interceptedBy) {
    const interceptedText = toTextContent(promptResult.result);
    const assistantMessage = await deps.db.createMessage({
      conversationId: conversation.id,
      role: "assistant",
      content: interceptedText,
      metadata: { interceptedBy: promptResult.interceptedBy },
    });
    await deps.db.touchConversation(conversation.id);

    return {
      kind: "json",
      status: 200,
      body: {
        success: true,
        conversationId: conversation.id,
        response: promptResult.result,
        interceptedBy: promptResult.interceptedBy,
        messages: {
          user: userMessage,
          assistant: assistantMessage,
        },
      },
    };
  }

  const tools = await deps.orchestrator.collectTools();
  const skills = await deps.orchestrator.collectSkills();
  chatLogger.debug("Capabilities resolved", {
    tools: tools.length,
    skills: skills.length,
  });
  const additionalSystemPrompt =
    typeof body.systemPrompt === "string" ? body.systemPrompt.trim() : "";
  const finalSystemPrompt = await buildFinalSystemPrompt({
    configuredSystemPrompt: deps.getConfiguredSystemPrompt(),
    additionalSystemPrompt,
    tools,
    skills,
    transformSystemMessage: async (input) =>
      await deps.orchestrator.transformSystemMessage(input),
  });

  let contextCompaction: ContextCompactionResult | null = null;
  if (contextCompactionConfig.autoCompact) {
    const estimatedPromptTokens = estimateMessagesTokens([
      { role: "system", content: finalSystemPrompt },
      ...historyMessages,
      { role: "user", content: toTextContent(promptResult.result || message) },
    ]);
    if (estimatedPromptTokens >= contextCompactionConfig.compactWhenTokensReach) {
      contextCompaction = await runConversationCompaction({
        messages: toContextMessages(historyRows),
        config: contextCompactionConfig,
        reason: "auto",
        force: false,
        retainMessageIds: userMessage?.id ? [userMessage.id] : undefined,
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

      if (contextCompaction.compacted) {
        chatLogger.info(
          "Context auto-compacted",
          {
            conversationId: conversation.id,
            beforeTokens: contextCompaction.beforeTokens,
            afterTokens: contextCompaction.afterTokens,
            deletedMessages: contextCompaction.deletedMessages,
          },
          { essential: true },
        );
        historyRows = await deps.db.getMessages(conversation.id, {
          limit: historyFetchLimit,
        });
        historyMessages = toConversationHistoryMessages(
          toContextMessages(historyRows),
          {
            excludeMessageIds: userMessage?.id
              ? new Set([userMessage.id])
              : undefined,
          },
        );
      }
    }
  }

  const pipelineMessages = [
    { role: "system" as const, content: finalSystemPrompt },
    ...historyMessages,
    { role: "user" as const, content: toTextContent(promptResult.result || message) },
  ];

  const llmCallResult = await deps.orchestrator.beforeLLMCall(pipelineMessages);
  chatLogger.debug("Pre-LLM pipeline result", {
    success: llmCallResult.success,
    interceptedBy: llmCallResult.interceptedBy,
  });

  if (!llmCallResult.success) {
    return {
      kind: "json",
      status: 403,
      body: {
        success: false,
        message: llmCallResult.error?.message || "LLM call blocked",
        code: llmCallResult.error?.code,
        conversationId: conversation.id,
        messageId: userMessage?.id,
      },
    };
  }

  if (llmCallResult.interceptedBy) {
    const interceptedText = toTextContent(llmCallResult.result);
    const assistantMessage = await deps.db.createMessage({
      conversationId: conversation.id,
      role: "assistant",
      content: interceptedText,
      metadata: { interceptedBy: llmCallResult.interceptedBy },
    });
    await deps.db.touchConversation(conversation.id);

    return {
      kind: "json",
      status: 200,
      body: {
        success: true,
        conversationId: conversation.id,
        response: llmCallResult.result,
        interceptedBy: llmCallResult.interceptedBy,
        messages: {
          user: userMessage,
          assistant: assistantMessage,
        },
      },
    };
  }

  const { mergedTools } = buildAIToolDefinitions(tools, skills);
  const llmMessages = toLLMMessages(llmCallResult.result || pipelineMessages);

  if (wantsStream(acceptHeader, body as { stream?: boolean })) {
    chatLogger.debug("Using streaming response mode");
    const streamId = createSSESession();
    const sendEvent = (event: string, payload: unknown) => {
      appendSSESessionEvent(streamId, event, payload);
    };

    void (async () => {
      const persistedToolEvents: PersistedToolEvent[] = [];
      try {
        sendEvent("meta", {
          streamId,
          conversationId: conversation.id,
          userMessageId: userMessage?.id,
        });
        if (contextCompaction?.compacted) {
          sendEvent("context_compacted", contextCompaction);
        }

        const aiClient = deps.getAIClient();
        const executedTools: ExecutedToolContext[] = [];
        const streamToolExecutor = createToolExecutor({
          emitToolEvent: sendEvent,
          onToolCompleted: (tool) => {
            executedTools.push(tool);
          },
          onToolEvent: (event) => {
            persistedToolEvents.push(event);
          },
          executeSkill: async (toolName, args) =>
            await deps.orchestrator.executeSkill(toolName, args),
          executeTool: async (toolName, args) =>
            await deps.orchestrator.executeTool(toolName, args, {
              source: "llm",
            }),
          onDebug: (message, meta) => chatLogger.debug(message, meta),
          onWarn: (message, meta) => chatLogger.warn(message, meta),
        });
        const iterator = aiClient
          .chatStream({
            messages: llmMessages,
            tools: mergedTools,
            toolChoice: mergedTools ? "auto" : "none",
            toolExecutor: streamToolExecutor,
          })
          [Symbol.asyncIterator]();

        let rawAssistantResponse = "";
        let toolCalls: Array<{
          id: string;
          name: string;
          arguments: Record<string, unknown>;
        }> = [];

        while (true) {
          const next = await iterator.next();
          if (next.done) {
            rawAssistantResponse = next.value.content || rawAssistantResponse;
            toolCalls = next.value.toolCalls || [];
            break;
          }
          if (next.value.textDelta) {
            rawAssistantResponse += next.value.textDelta;
            sendEvent("delta", { text: next.value.textDelta });
          }
        }

        const finalResponse = await deps.orchestrator.afterLLMCall(
          rawAssistantResponse.trim().length === 0 && executedTools.length > 0
            ? await fallbackFromToolResults(aiClient, llmMessages, executedTools)
            : rawAssistantResponse,
        );

        const assistantMetadata: Record<string, unknown> = {};
        if (toolCalls.length > 0) assistantMetadata.toolCalls = toolCalls;
        if (persistedToolEvents.length > 0) {
          assistantMetadata.toolEvents = persistedToolEvents;
        }
        const assistantMessage = await deps.db.createMessage({
          conversationId: conversation.id,
          role: "assistant",
          content: finalResponse,
          metadata: assistantMetadata,
        });
        await deps.db.touchConversation(conversation.id);

        sendEvent("done", {
          conversationId: conversation.id,
          userMessageId: userMessage?.id,
          assistantMessageId: assistantMessage?.id,
          response: finalResponse,
          toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
          contextCompaction: contextCompaction?.compacted
            ? contextCompaction
            : undefined,
        });
      } catch (error) {
        if (error instanceof ToolTerminalResponseError) {
          const finalResponse = await deps.orchestrator.afterLLMCall(
            error.terminalResponse,
          );
          const assistantMessage = await deps.db.createMessage({
            conversationId: conversation.id,
            role: "assistant",
            content: finalResponse,
            metadata: {
              terminalByTool: error.toolName,
              terminalSource: error.source,
              ...(persistedToolEvents.length > 0
                ? { toolEvents: persistedToolEvents }
                : {}),
            },
          });
          await deps.db.touchConversation(conversation.id);
          sendEvent("done", {
            conversationId: conversation.id,
            userMessageId: userMessage?.id,
            assistantMessageId: assistantMessage?.id,
            response: finalResponse,
          });
          closeSSESession(streamId);
          return;
        }
        sendEvent("error", {
          message: "Chat streaming failed",
          error: (error as Error).message,
        });
      } finally {
        closeSSESession(streamId);
      }
    })();

    return {
      kind: "stream",
      stream: createSSESessionReadable(streamId),
    };
  }

  const aiClient = deps.getAIClient();
  const executedTools: ExecutedToolContext[] = [];
  const persistedToolEvents: PersistedToolEvent[] = [];
  const toolExecutor = createToolExecutor({
    onToolCompleted: (tool) => {
      executedTools.push(tool);
    },
    onToolEvent: (event) => {
      persistedToolEvents.push(event);
    },
    executeSkill: async (toolName, args) =>
      await deps.orchestrator.executeSkill(toolName, args),
    executeTool: async (toolName, args) =>
      await deps.orchestrator.executeTool(toolName, args, {
        source: "llm",
      }),
    onDebug: (message, meta) => chatLogger.debug(message, meta),
    onWarn: (message, meta) => chatLogger.warn(message, meta),
  });

  let aiResult;
  try {
    aiResult = await aiClient.chat({
      messages: llmMessages,
      tools: mergedTools,
      toolChoice: mergedTools ? "auto" : "none",
      toolExecutor,
    });
  } catch (error) {
    if (error instanceof ToolTerminalResponseError) {
      const finalResponse = await deps.orchestrator.afterLLMCall(
        error.terminalResponse,
      );
      const assistantMessage = await deps.db.createMessage({
        conversationId: conversation.id,
        role: "assistant",
        content: finalResponse,
        metadata: {
          terminalByTool: error.toolName,
          terminalSource: error.source,
          ...(persistedToolEvents.length > 0
            ? { toolEvents: persistedToolEvents }
            : {}),
        },
      });
      await deps.db.touchConversation(conversation.id);
      return {
        kind: "json",
        status: 200,
        body: {
          success: true,
          conversationId: conversation.id,
          response: finalResponse,
          tools: tools.length > 0 ? tools.map((t) => t.name) : undefined,
          skills: skills.length > 0 ? skills.map((s) => s.name) : undefined,
          toolCalls: [],
          contextCompaction: contextCompaction?.compacted
            ? contextCompaction
            : undefined,
          messages: {
            user: userMessage,
            assistant: assistantMessage,
          },
        },
      };
    }
    throw error;
  }

  const rawFinalContent =
    aiResult.content.trim().length === 0 && executedTools.length > 0
      ? await fallbackFromToolResults(aiClient, llmMessages, executedTools)
      : aiResult.content;
  const finalResponse = await deps.orchestrator.afterLLMCall(rawFinalContent);
  const assistantMetadata: Record<string, unknown> = {};
  if (aiResult.toolCalls.length > 0) {
    assistantMetadata.toolCalls = aiResult.toolCalls;
  }
  if (persistedToolEvents.length > 0) {
    assistantMetadata.toolEvents = persistedToolEvents;
  }
  const assistantMessage = await deps.db.createMessage({
    conversationId: conversation.id,
    role: "assistant",
    content: finalResponse,
    metadata: assistantMetadata,
  });
  await deps.db.touchConversation(conversation.id);

  return {
    kind: "json",
    status: 200,
    body: {
      success: true,
      conversationId: conversation.id,
      response: finalResponse,
      tools: tools.length > 0 ? tools.map((t) => t.name) : undefined,
      skills: skills.length > 0 ? skills.map((s) => s.name) : undefined,
      toolCalls: aiResult.toolCalls.length > 0 ? aiResult.toolCalls : undefined,
      contextCompaction: contextCompaction?.compacted
        ? contextCompaction
        : undefined,
      messages: {
        user: userMessage,
        assistant: assistantMessage,
      },
    },
  };
}
