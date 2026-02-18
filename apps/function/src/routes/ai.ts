import type { ToolDefinition } from "@workspace/core";
import { primaryActions as pDB } from "@workspace/db";
import type { Hono } from "hono";
import { createScopedLogger } from "../lib/logging";
import type { AIRouteDeps } from "./types";

type ChatRequestBody = {
  message: string;
  systemPrompt?: string;
  conversationId?: string;
  profileId?: string;
  title?: string;
  stream?: boolean;
};

type ConversationTitleUpdateBody = {
  title?: string;
};

const DEFAULT_PERSONALITY_SYSTEM_PROMPT = [
  "You are Frontclaw AI, a practical and reliable assistant.",
  "Prioritize accurate, safe, and actionable responses.",
  "Be concise by default, but provide details when explicitly requested or when complexity requires it.",
  "If tools are available and needed for current information, call them and use their outputs.",
].join(" ");

function parsePagingValue(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed < 0) return fallback;
  return parsed;
}

function toTextContent(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function toPreview(value: unknown, maxLength = 400): string {
  const text = toTextContent(value);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}...`;
}

type ExecutedToolContext = {
  toolName: string;
  args: Record<string, unknown>;
  source: "tool" | "skill";
  result: unknown;
};

class ToolTerminalResponseError extends Error {
  readonly terminalResponse: string;
  readonly toolName: string;
  readonly source: "tool" | "skill";

  constructor(
    terminalResponse: string,
    toolName: string,
    source: "tool" | "skill",
  ) {
    super(`Tool '${toolName}' ended request`);
    this.name = "ToolTerminalResponseError";
    this.terminalResponse = terminalResponse;
    this.toolName = toolName;
    this.source = source;
  }
}

type ToolExecutionMode = "handoff_to_llm" | "end_request";

type ToolControlEnvelope = {
  __frontclaw?: {
    mode?: ToolExecutionMode;
    response?: unknown;
  };
  data?: unknown;
};

function resolveToolOutputRouting(raw: unknown): {
  mode: ToolExecutionMode;
  llmPayload: unknown;
  terminalResponse?: string;
} {
  if (!raw || typeof raw !== "object") {
    return { mode: "handoff_to_llm", llmPayload: raw };
  }

  const envelope = raw as ToolControlEnvelope;
  const mode = envelope.__frontclaw?.mode;

  if (mode === "end_request") {
    const response =
      envelope.__frontclaw?.response !== undefined
        ? envelope.__frontclaw.response
        : envelope.data !== undefined
          ? envelope.data
          : raw;
    return {
      mode: "end_request",
      llmPayload: raw,
      terminalResponse: toTextContent(response),
    };
  }

  const handoffPayload = envelope.data !== undefined ? envelope.data : raw;
  return {
    mode: "handoff_to_llm",
    llmPayload: handoffPayload,
  };
}

async function fallbackFromToolResults(
  aiClient: ReturnType<AIRouteDeps["getAIClient"]>,
  baseMessages: Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }>,
  executedTools: ExecutedToolContext[],
): Promise<string> {
  if (executedTools.length === 0) return "";

  const fallbackResult = await aiClient.chat({
    messages: [
      ...baseMessages,
      {
        role: "assistant",
        content:
          "Tool execution finished. I will now synthesize a final answer using the tool outputs.",
      },
      {
        role: "user",
        content: `Tool outputs (JSON): ${JSON.stringify(executedTools)}`,
      },
      {
        role: "user",
        content:
          "Provide the best final response to the original user request using the tool outputs above.",
      },
    ],
    toolChoice: "none",
  });

  return fallbackResult.content || "";
}

function hasConversationTitle(title: string | null | undefined): boolean {
  return typeof title === "string" && title.trim().length > 0;
}

function deriveConversationTitle(prompt: string): string {
  const maxLength = 150;
  const normalized = prompt
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[`*_#>\[\]\(\)]/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) {
    return "New conversation";
  }

  let title = normalized;
  const sentenceMatch = normalized.match(/^(.{1,150}?)([.!?]|$)/);
  if (sentenceMatch?.[1] && sentenceMatch[1].trim().length >= 8) {
    title = sentenceMatch[1].trim();
  }

  if (title.length > maxLength) {
    const shortened = title.slice(0, maxLength).trimEnd();
    const lastSpace = shortened.lastIndexOf(" ");
    title = lastSpace > 40 ? shortened.slice(0, lastSpace) : shortened;
  }

  return title;
}

function normalizeConversationTitle(title: string): string {
  const maxLength = 150;
  const normalized = title.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  return normalized.slice(0, maxLength);
}

function toSSEChunk(event: string, payload: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
}

function toConversationHistory(
  history: Awaited<ReturnType<typeof pDB.getMessages>>,
): Array<{ role: "user" | "assistant"; content: string }> {
  const mapped: Array<{ role: "user" | "assistant"; content: string }> = [];

  for (const entry of history) {
    if (entry.role === "user" || entry.role === "assistant") {
      mapped.push({ role: entry.role, content: entry.content });
    }
  }

  return mapped;
}

function toLLMMessages(
  messages: Array<{ role: string; content: string }>,
): Array<{ role: "system" | "user" | "assistant"; content: string }> {
  return messages
    .filter(
      (m) =>
        m.role === "system" || m.role === "user" || m.role === "assistant",
    )
    .map((m) => ({
      role: m.role as "system" | "user" | "assistant",
      content: m.content,
    }));
}

function wantsStream(
  acceptHeader: string | undefined,
  body: ChatRequestBody,
): boolean {
  if (body.stream === true) return true;
  return (acceptHeader || "").includes("text/event-stream");
}

function buildToolContext(
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
    inputSchema?: {
      properties?: Record<string, unknown>;
      required?: string[];
    };
  }>,
): string {
  if (tools.length === 0 && skills.length === 0) {
    return "";
  }

  const lines: string[] = [
    "AVAILABLE TOOLS (LLM-CALLABLE):",
    "Call tools when needed. Use exact names and valid JSON arguments.",
  ];

  for (const tool of tools) {
    const properties = Object.keys(tool.parameters?.properties || {});
    const required = tool.parameters?.required || [];
    lines.push(
      `- ${tool.name}: ${tool.description || "No description"}; args=[${properties.join(", ")}]; required=[${required.join(", ")}]`,
    );
  }

  for (const skill of skills) {
    const properties = Object.keys(skill.inputSchema?.properties || {});
    const required = skill.inputSchema?.required || [];
    lines.push(
      `- ${skill.name}: ${skill.description || "No description"}; args=[${properties.join(", ")}]; required=[${required.join(", ")}]`,
    );
  }

  return lines.join("\n");
}

export function registerAIRoutes(app: Hono, deps: AIRouteDeps) {
  const {
    orchestrator,
    orchestratorReady,
    aiReady,
    getAIClient,
    getConfiguredSystemPrompt,
  } = deps;
  const chatLogger = createScopedLogger("chat");

  app.get("/api/v1/conversations", async (c) => {
    try {
      const profileId = c.req.query("profileId");
      const limit = parsePagingValue(c.req.query("limit"), 50);
      const offset = parsePagingValue(c.req.query("offset"), 0);

      const conversations = await pDB.getConversations({
        profileId,
        limit,
        offset,
      });

      return c.json({
        success: true,
        conversations,
        count: conversations.length,
      });
    } catch (error) {
      console.error(error);
      return c.json(
        {
          success: false,
          message: "Failed to fetch conversations",
        },
        500,
      );
    }
  });

  app.post("/api/v1/conversations", async (c) => {
    try {
      const body = (await c.req.json().catch(() => ({}))) as {
        profileId?: string;
        title?: string;
        metadata?: Record<string, unknown>;
      };

      const conversation = await pDB.createConversation({
        profileId: body.profileId,
        title: body.title,
        metadata: body.metadata,
      });

      return c.json({
        success: true,
        conversation,
      });
    } catch (error) {
      console.error(error);
      return c.json(
        {
          success: false,
          message: "Failed to create conversation",
        },
        500,
      );
    }
  });

  app.get("/api/v1/conversations/:conversationId", async (c) => {
    try {
      const conversationId = c.req.param("conversationId");
      const conversation = await pDB.getConversation(conversationId);

      if (!conversation) {
        return c.json(
          {
            success: false,
            message: "Conversation not found",
          },
          404,
        );
      }

      return c.json({
        success: true,
        conversation,
      });
    } catch (error) {
      console.error(error);
      return c.json(
        {
          success: false,
          message: "Failed to fetch conversation",
        },
        500,
      );
    }
  });

  app.put("/api/v1/conversations/:conversationId", async (c) => {
    try {
      const conversationId = c.req.param("conversationId");
      const body = (await c.req
        .json()
        .catch(() => ({}))) as ConversationTitleUpdateBody;
      const requestedTitle = typeof body.title === "string" ? body.title : "";
      const title = normalizeConversationTitle(requestedTitle);

      if (!title) {
        return c.json(
          {
            success: false,
            message: "Title is required",
          },
          400,
        );
      }

      const conversation = await pDB.getConversation(conversationId);
      if (!conversation) {
        return c.json(
          {
            success: false,
            message: "Conversation not found",
          },
          404,
        );
      }

      await pDB.setConversationTitle(conversationId, title);

      return c.json({
        success: true,
        conversation: {
          ...conversation,
          title,
        },
      });
    } catch (error) {
      console.error(error);
      return c.json(
        {
          success: false,
          message: "Failed to update conversation",
        },
        500,
      );
    }
  });

  app.delete("/api/v1/conversations/:conversationId", async (c) => {
    try {
      const conversationId = c.req.param("conversationId");
      const conversation = await pDB.getConversation(conversationId);
      if (!conversation) {
        return c.json(
          {
            success: false,
            message: "Conversation not found",
          },
          404,
        );
      }

      await pDB.deleteConversation(conversationId);

      return c.json({
        success: true,
      });
    } catch (error) {
      console.error(error);
      return c.json(
        {
          success: false,
          message: "Failed to delete conversation",
        },
        500,
      );
    }
  });

  app.get("/api/v1/conversations/:conversationId/messages", async (c) => {
    try {
      const conversationId = c.req.param("conversationId");
      const limit = parsePagingValue(c.req.query("limit"), 100);
      const offset = parsePagingValue(c.req.query("offset"), 0);

      const conversation = await pDB.getConversation(conversationId);
      if (!conversation) {
        return c.json(
          {
            success: false,
            message: "Conversation not found",
          },
          404,
        );
      }

      const messages = await pDB.getMessages(conversationId, { limit, offset });

      return c.json({
        success: true,
        conversation,
        messages,
        count: messages.length,
      });
    } catch (error) {
      console.error(error);
      return c.json(
        {
          success: false,
          message: "Failed to fetch messages",
        },
        500,
      );
    }
  });

  app.post("/api/v1/conversations/:conversationId/clone", async (c) => {
    try {
      const conversationId = c.req.param("conversationId");
      const body = (await c.req.json().catch(() => ({}))) as {
        messageId?: string;
        profileId?: string;
        title?: string;
      };

      const conversation = await pDB.getConversation(conversationId);
      if (!conversation) {
        return c.json(
          {
            success: false,
            message: "Conversation not found",
          },
          404,
        );
      }

      const allMessages = await pDB.getMessages(conversationId, {
        limit: 500,
      });
      let messagesToClone = allMessages;

      if (body.messageId) {
        const stopIndex = allMessages.findIndex(
          (entry) => entry.id === body.messageId,
        );
        if (stopIndex >= 0) {
          messagesToClone = allMessages.slice(0, stopIndex + 1);
        }
      }

      const existingMetadata =
        conversation.metadata &&
        typeof conversation.metadata === "object" &&
        !Array.isArray(conversation.metadata)
          ? (conversation.metadata as Record<string, unknown>)
          : {};

      const cloned = await pDB.createConversation({
        profileId: body.profileId ?? conversation.profileId ?? undefined,
        title: body.title ?? conversation.title ?? "Shared conversation",
        metadata: {
          ...existingMetadata,
          sharedFromConversationId: conversationId,
          sharedFromMessageId: body.messageId ?? null,
        },
      });

      if (!cloned) {
        return c.json(
          {
            success: false,
            message: "Failed to clone conversation",
          },
          500,
        );
      }

      for (const message of messagesToClone) {
        await pDB.createMessage({
          conversationId: cloned.id,
          role: message.role,
          content: message.content,
          toolName: message.toolName,
          toolCallId: message.toolCallId,
          metadata: message.metadata ?? {},
        });
      }

      return c.json({
        success: true,
        conversation: cloned,
      });
    } catch (error) {
      console.error(error);
      return c.json(
        {
          success: false,
          message: "Failed to clone conversation",
        },
        500,
      );
    }
  });

  app.get("/api/v1/conversations/:conversationId/context", async (c) => {
    try {
      await orchestratorReady;
      await aiReady;

      const conversationId = c.req.param("conversationId");
      const conversation = await pDB.getConversation(conversationId);
      if (!conversation) {
        return c.json(
          {
            success: false,
            message: "Conversation not found",
          },
          404,
        );
      }

      const limit = parsePagingValue(c.req.query("limit"), 100);
      const requestedMessage = (c.req.query("message") || "").trim();
      const additionalSystemPrompt = (c.req.query("systemPrompt") || "").trim();

      const historyRows = await pDB.getMessages(conversation.id, { limit });
      const historyMessages = toConversationHistory(historyRows);

      const tools = await orchestrator.collectTools();
      const skills = await orchestrator.collectSkills();
      const toolContext = buildToolContext(tools, skills);

      const personalitySystemPrompt =
        getConfiguredSystemPrompt() || DEFAULT_PERSONALITY_SYSTEM_PROMPT;
      const baseSystemPrompt = additionalSystemPrompt
        ? `${personalitySystemPrompt}\n\nAdditional system instructions:\n${additionalSystemPrompt}`
        : personalitySystemPrompt;
      const transformedSystemPrompt =
        await orchestrator.transformSystemMessage(baseSystemPrompt);
      const finalSystemPrompt = toolContext
        ? `${transformedSystemPrompt}\n\n${toolContext}`
        : transformedSystemPrompt;

      let promptResult:
        | { success: true; content: string; interceptedBy?: string }
        | { success: false; code?: string; message: string; blockedBy?: string }
        | null = null;

      let userMessageForContext = requestedMessage;
      if (requestedMessage) {
        const processedPrompt = await orchestrator.processPrompt(requestedMessage);
        if (!processedPrompt.success) {
          return c.json(
            {
              success: false,
              message: processedPrompt.error?.message || "Prompt processing failed",
              code: processedPrompt.error?.code,
              blockedBy: processedPrompt.error?.pluginId,
              conversationId: conversation.id,
            },
            403,
          );
        }
        userMessageForContext = toTextContent(processedPrompt.result || requestedMessage);
        promptResult = {
          success: true,
          content: userMessageForContext,
          interceptedBy: processedPrompt.interceptedBy || undefined,
        };
      }

      const pipelineMessages = [
        { role: "system" as const, content: finalSystemPrompt },
        ...historyMessages,
        ...(userMessageForContext
          ? [{ role: "user" as const, content: userMessageForContext }]
          : []),
      ];

      const llmCallResult = await orchestrator.beforeLLMCall(pipelineMessages);
      if (!llmCallResult.success) {
        return c.json(
          {
            success: false,
            message: llmCallResult.error?.message || "LLM call blocked",
            code: llmCallResult.error?.code,
            blockedBy: llmCallResult.error?.pluginId,
            conversationId: conversation.id,
          },
          403,
        );
      }

      const llmMessages = toLLMMessages(llmCallResult.result || pipelineMessages);

      return c.json({
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
        },
      });
    } catch (error) {
      console.error(error);
      return c.json(
        {
          success: false,
          message: "Failed to build context",
        },
        500,
      );
    }
  });

  app.post("/api/v1/chat", async (c) => {
    try {
      chatLogger.info("Incoming chat request", undefined, { essential: true });
      await orchestratorReady;
      await aiReady;
      chatLogger.debug("Dependencies ready");

      const body = (await c.req.json()) as Partial<ChatRequestBody>;
      const message =
        typeof body.message === "string" ? body.message.trim() : "";
      chatLogger.debug("Parsed request payload", {
        hasConversationId: !!body.conversationId,
        messageLength: message.length,
        stream: body.stream === true,
      });

      if (!message) {
        return c.json({ success: false, message: "Message is required" }, 400);
      }

      let conversation = body.conversationId
        ? await pDB.getConversation(body.conversationId)
        : await pDB.createConversation({
            profileId: body.profileId,
            title: body.title || deriveConversationTitle(message),
            metadata: {},
          });

      if (!conversation) {
        return c.json(
          { success: false, message: "Conversation not found" },
          404,
        );
      }

      const historyRows = await pDB.getMessages(conversation.id, {
        limit: 100,
      });
      const historyMessages = toConversationHistory(historyRows);

      const userMessage = await pDB.createMessage({
        conversationId: conversation.id,
        role: "user",
        content: message,
      });
      await pDB.touchConversation(conversation.id);

      const promptResult = await orchestrator.processPrompt(message);
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
        await pDB.setConversationTitle(conversation.id, title);
        conversation = {
          ...conversation,
          title,
        };
      }

      if (!promptResult.success) {
        return c.json(
          {
            success: false,
            message: promptResult.error?.message || "Prompt processing failed",
            code: promptResult.error?.code,
            blockedBy: promptResult.error?.pluginId,
            conversationId: conversation.id,
            messageId: userMessage?.id,
          },
          403,
        );
      }

      if (promptResult.interceptedBy) {
        const interceptedText = toTextContent(promptResult.result);
        const assistantMessage = await pDB.createMessage({
          conversationId: conversation.id,
          role: "assistant",
          content: interceptedText,
          metadata: { interceptedBy: promptResult.interceptedBy },
        });
        await pDB.touchConversation(conversation.id);

        return c.json({
          success: true,
          conversationId: conversation.id,
          response: promptResult.result,
          interceptedBy: promptResult.interceptedBy,
          messages: {
            user: userMessage,
            assistant: assistantMessage,
          },
        });
      }

      const tools = await orchestrator.collectTools();
      const skills = await orchestrator.collectSkills();
      chatLogger.debug("Capabilities resolved", {
        tools: tools.length,
        skills: skills.length,
      });
      const toolContext = buildToolContext(tools, skills);

      const personalitySystemPrompt =
        getConfiguredSystemPrompt() || DEFAULT_PERSONALITY_SYSTEM_PROMPT;
      const additionalSystemPrompt =
        typeof body.systemPrompt === "string" ? body.systemPrompt.trim() : "";
      const baseSystemPrompt = additionalSystemPrompt
        ? `${personalitySystemPrompt}\n\nAdditional system instructions:\n${additionalSystemPrompt}`
        : personalitySystemPrompt;
      const transformedSystemPrompt =
        await orchestrator.transformSystemMessage(baseSystemPrompt);
      const finalSystemPrompt = toolContext
        ? `${transformedSystemPrompt}\n\n${toolContext}`
        : transformedSystemPrompt;

      const pipelineMessages = [
        { role: "system" as const, content: finalSystemPrompt },
        ...historyMessages,
        { role: "user" as const, content: promptResult.result || message },
      ];

      const llmCallResult = await orchestrator.beforeLLMCall(pipelineMessages);
      chatLogger.debug("Pre-LLM pipeline result", {
        success: llmCallResult.success,
        interceptedBy: llmCallResult.interceptedBy,
      });

      if (!llmCallResult.success) {
        return c.json(
          {
            success: false,
            message: llmCallResult.error?.message || "LLM call blocked",
            code: llmCallResult.error?.code,
            conversationId: conversation.id,
            messageId: userMessage?.id,
          },
          403,
        );
      }

      if (llmCallResult.interceptedBy) {
        const interceptedText = toTextContent(llmCallResult.result);
        const assistantMessage = await pDB.createMessage({
          conversationId: conversation.id,
          role: "assistant",
          content: interceptedText,
          metadata: { interceptedBy: llmCallResult.interceptedBy },
        });
        await pDB.touchConversation(conversation.id);

        return c.json({
          success: true,
          conversationId: conversation.id,
          response: llmCallResult.result,
          interceptedBy: llmCallResult.interceptedBy,
          messages: {
            user: userMessage,
            assistant: assistantMessage,
          },
        });
      }

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

      const llmMessages = toLLMMessages(llmCallResult.result || pipelineMessages);

      const createToolExecutor = (
        emitToolEvent?: (event: string, payload: unknown) => void,
        onToolCompleted?: (tool: ExecutedToolContext) => void,
      ) => {
        return async (toolName: string, args: Record<string, unknown>) => {
          chatLogger.debug("Tool execution started", { toolName, args });
          const startedAt = Date.now();
          emitToolEvent?.("tool_start", {
            toolName,
            args,
            startedAt,
          });

          try {
            const skillResult = await orchestrator.executeSkill(toolName, args);
            if (skillResult.success) {
              const durationMs = Date.now() - startedAt;
              chatLogger.debug("Skill execution completed", {
                toolName,
                durationMs,
              });
              const routing = resolveToolOutputRouting(skillResult.result);
              onToolCompleted?.({
                toolName,
                args,
                source: "skill",
                result: routing.llmPayload,
              });
              emitToolEvent?.("tool_result", {
                toolName,
                source: "skill",
                durationMs,
                resultPreview: toPreview(
                  routing.mode === "end_request"
                    ? routing.terminalResponse
                    : routing.llmPayload,
                ),
              });
              if (routing.mode === "end_request") {
                throw new ToolTerminalResponseError(
                  routing.terminalResponse || "",
                  toolName,
                  "skill",
                );
              }
              return routing.llmPayload;
            }

            const toolResult = await orchestrator.executeTool(toolName, args, {
              source: "llm",
            });
            if (!toolResult.success) {
              throw new Error(toolResult.error || "Tool execution failed");
            }

            const durationMs = Date.now() - startedAt;
            chatLogger.debug("Tool execution completed", {
              toolName,
              durationMs,
            });
            const routing = resolveToolOutputRouting(toolResult.result);
            onToolCompleted?.({
              toolName,
              args,
              source: "tool",
              result: routing.llmPayload,
            });
            emitToolEvent?.("tool_result", {
              toolName,
              source: "tool",
              durationMs,
              resultPreview: toPreview(
                routing.mode === "end_request"
                  ? routing.terminalResponse
                  : routing.llmPayload,
              ),
            });
            if (routing.mode === "end_request") {
              throw new ToolTerminalResponseError(
                routing.terminalResponse || "",
                toolName,
                "tool",
              );
            }
            return routing.llmPayload;
          } catch (error) {
            const durationMs = Date.now() - startedAt;
            if (!(error instanceof ToolTerminalResponseError)) {
              chatLogger.warn("Tool execution failed", {
                toolName,
                durationMs,
                error: (error as Error).message,
              });
              emitToolEvent?.("tool_error", {
                toolName,
                durationMs,
                error: (error as Error).message,
              });
            }
            throw error;
          }
        };
      };

      const mergedTools =
        aiTools.length > 0 || aiSkills.length > 0
          ? [...aiTools, ...aiSkills]
          : undefined;

      if (wantsStream(c.req.header("accept"), body as ChatRequestBody)) {
        chatLogger.debug("Using streaming response mode");
        const encoder = new TextEncoder();

        const stream = new ReadableStream<Uint8Array>({
          start: async (controller) => {
            let isClosed = false;
            const closeOnce = () => {
              if (isClosed) return;
              isClosed = true;
              try {
                controller.close();
              } catch {
                // Ignore close errors (already closed/disconnected)
              }
            };
            const sendEvent = (event: string, payload: unknown) => {
              if (isClosed) return false;
              try {
                controller.enqueue(encoder.encode(toSSEChunk(event, payload)));
                return true;
              } catch {
                isClosed = true;
                return false;
              }
            };

            try {
              sendEvent("meta", {
                conversationId: conversation.id,
                userMessageId: userMessage?.id,
              });

              const aiClient = getAIClient();
              const executedTools: ExecutedToolContext[] = [];
              const streamToolExecutor = createToolExecutor(sendEvent, (tool) => {
                executedTools.push(tool);
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
                  toolCalls = next.value.toolCalls;
                  break;
                }

                if (next.value.textDelta) {
                  rawAssistantResponse += next.value.textDelta;
                  if (!sendEvent("delta", { text: next.value.textDelta })) {
                    break;
                  }
                }
              }

              const finalResponse =
                await orchestrator.afterLLMCall(
                  rawAssistantResponse.trim().length === 0 && executedTools.length > 0
                    ? await fallbackFromToolResults(aiClient, llmMessages, executedTools)
                    : rawAssistantResponse,
                );
              if (rawAssistantResponse.trim().length === 0 && executedTools.length > 0) {
                chatLogger.info(
                  "Applied fallback synthesis after empty post-tool stream response",
                  { executedTools: executedTools.length },
                  { essential: true },
                );
              }

              const assistantMessage = await pDB.createMessage({
                conversationId: conversation.id,
                role: "assistant",
                content: finalResponse,
                metadata: toolCalls.length > 0 ? { toolCalls } : {},
              });
              await pDB.touchConversation(conversation.id);

              sendEvent("done", {
                conversationId: conversation.id,
                userMessageId: userMessage?.id,
                assistantMessageId: assistantMessage?.id,
                response: finalResponse,
                toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
              });
              chatLogger.info(
                "Streaming chat completed",
                { conversationId: conversation.id, toolCalls: toolCalls.length },
                { essential: true },
              );
              closeOnce();
            } catch (error) {
              if (error instanceof ToolTerminalResponseError) {
                const finalResponse = await orchestrator.afterLLMCall(
                  error.terminalResponse,
                );
                const assistantMessage = await pDB.createMessage({
                  conversationId: conversation.id,
                  role: "assistant",
                  content: finalResponse,
                  metadata: {
                    terminalByTool: error.toolName,
                    terminalSource: error.source,
                  },
                });
                await pDB.touchConversation(conversation.id);
                sendEvent("done", {
                  conversationId: conversation.id,
                  userMessageId: userMessage?.id,
                  assistantMessageId: assistantMessage?.id,
                  response: finalResponse,
                });
                chatLogger.info(
                  "Request ended directly by tool response",
                  { toolName: error.toolName, source: error.source },
                  { essential: true },
                );
                closeOnce();
                return;
              }
              chatLogger.error("Streaming chat failed", error);
              sendEvent("error", {
                message: "Chat streaming failed",
                error: (error as Error).message,
              });
              closeOnce();
            }
          },
        });

        return new Response(stream, {
          status: 200,
          headers: {
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
          },
        });
      }

      const aiClient = getAIClient();
      const executedTools: ExecutedToolContext[] = [];
      const toolExecutor = createToolExecutor(undefined, (tool) => {
        executedTools.push(tool);
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
          const finalResponse = await orchestrator.afterLLMCall(
            error.terminalResponse,
          );
          const assistantMessage = await pDB.createMessage({
            conversationId: conversation.id,
            role: "assistant",
            content: finalResponse,
            metadata: {
              terminalByTool: error.toolName,
              terminalSource: error.source,
            },
          });
          await pDB.touchConversation(conversation.id);
          chatLogger.info(
            "Request ended directly by tool response",
            { toolName: error.toolName, source: error.source },
            { essential: true },
          );
          return c.json({
            success: true,
            conversationId: conversation.id,
            response: finalResponse,
            tools: tools.length > 0 ? tools.map((t) => t.name) : undefined,
            skills: skills.length > 0 ? skills.map((s) => s.name) : undefined,
            toolCalls: [],
            messages: {
              user: userMessage,
              assistant: assistantMessage,
            },
          });
        }
        throw error;
      }

      const rawFinalContent =
        aiResult.content.trim().length === 0 && executedTools.length > 0
          ? await fallbackFromToolResults(aiClient, llmMessages, executedTools)
          : aiResult.content;
      if (aiResult.content.trim().length === 0 && executedTools.length > 0) {
        chatLogger.info(
          "Applied fallback synthesis after empty post-tool response",
          { executedTools: executedTools.length },
          { essential: true },
        );
      }
      const finalResponse = await orchestrator.afterLLMCall(rawFinalContent);
      const assistantMessage = await pDB.createMessage({
        conversationId: conversation.id,
        role: "assistant",
        content: finalResponse,
        metadata:
          aiResult.toolCalls.length > 0
            ? { toolCalls: aiResult.toolCalls }
            : {},
      });
      await pDB.touchConversation(conversation.id);

      return c.json({
        success: true,
        conversationId: conversation.id,
        response: finalResponse,
        tools: tools.length > 0 ? tools.map((t) => t.name) : undefined,
        skills: skills.length > 0 ? skills.map((s) => s.name) : undefined,
        toolCalls:
          aiResult.toolCalls.length > 0 ? aiResult.toolCalls : undefined,
        messages: {
          user: userMessage,
          assistant: assistantMessage,
        },
      });
    } catch (error) {
      chatLogger.error("Chat processing failed", error);
      return c.json(
        {
          success: false,
          message: "Chat processing failed",
          error: (error as Error).message,
        },
        500,
      );
    }
  });

  app.get("/api/v1/search", async (c) => {
    try {
      await orchestratorReady;
      await aiReady;
      const { q, limit } = c.req.query();

      if (!q) {
        return c.json(
          { success: false, message: "Query parameter 'q' is required" },
          400,
        );
      }

      const results = await orchestrator.search({
        query: q,
        limit: limit ? parseInt(limit, 10) : undefined,
      });

      return c.json({
        success: true,
        results,
        count: results.length,
      });
    } catch (error) {
      console.error(error);
      return c.json(
        {
          success: false,
          message: "Search failed",
        },
        500,
      );
    }
  });
}
