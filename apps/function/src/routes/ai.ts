import type { ToolDefinition } from "@workspace/core";
import { primaryActions as pDB } from "@workspace/db";
import type { Hono } from "hono";
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

function wantsStream(
  acceptHeader: string | undefined,
  body: ChatRequestBody,
): boolean {
  if (body.stream === true) return true;
  return (acceptHeader || "").includes("text/event-stream");
}

export function registerAIRoutes(app: Hono, deps: AIRouteDeps) {
  const { orchestrator, orchestratorReady, aiReady, getAIClient } = deps;

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

  app.post("/api/v1/chat", async (c) => {
    try {
      await orchestratorReady;
      await aiReady;

      const body = (await c.req.json()) as Partial<ChatRequestBody>;
      const message =
        typeof body.message === "string" ? body.message.trim() : "";

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

      const baseSystemPrompt =
        body.systemPrompt || "You are a helpful assistant.";
      const finalSystemPrompt =
        await orchestrator.transformSystemMessage(baseSystemPrompt);

      const tools = await orchestrator.collectTools();
      const skills = await orchestrator.collectSkills();

      const pipelineMessages = [
        { role: "system" as const, content: finalSystemPrompt },
        ...historyMessages,
        { role: "user" as const, content: promptResult.result || message },
      ];

      const llmCallResult = await orchestrator.beforeLLMCall(pipelineMessages);

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

      const llmMessages = (llmCallResult.result || pipelineMessages)
        .filter((m) => m.role !== "system")
        .map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        }));

      const toolExecutor = async (
        toolName: string,
        args: Record<string, unknown>,
      ) => {
        const skillResult = await orchestrator.executeSkill(toolName, args);
        if (skillResult.success) {
          return skillResult.result;
        }

        const toolResult = await orchestrator.executeTool(toolName, args);
        if (!toolResult.success) {
          throw new Error(toolResult.error || "Tool execution failed");
        }
        return toolResult.result;
      };

      const mergedTools =
        aiTools.length > 0 || aiSkills.length > 0
          ? [...aiTools, ...aiSkills]
          : undefined;

      if (wantsStream(c.req.header("accept"), body as ChatRequestBody)) {
        const encoder = new TextEncoder();

        const stream = new ReadableStream<Uint8Array>({
          start: async (controller) => {
            const sendEvent = (event: string, payload: unknown) => {
              controller.enqueue(encoder.encode(toSSEChunk(event, payload)));
            };

            try {
              sendEvent("meta", {
                conversationId: conversation.id,
                userMessageId: userMessage?.id,
              });

              const aiClient = getAIClient();
              const iterator = aiClient
                .chatStream({
                  messages: llmMessages,
                  systemPrompt: finalSystemPrompt,
                  tools: mergedTools,
                  toolChoice: mergedTools ? "auto" : "none",
                  toolExecutor,
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
                  toolCalls = next.value.toolCalls;
                  break;
                }

                if (next.value.textDelta) {
                  rawAssistantResponse += next.value.textDelta;
                  sendEvent("delta", { text: next.value.textDelta });
                }
              }

              const finalResponse =
                await orchestrator.afterLLMCall(rawAssistantResponse);

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
              controller.close();
            } catch (error) {
              console.error(error);
              sendEvent("error", {
                message: "Chat streaming failed",
                error: (error as Error).message,
              });
              controller.close();
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
      const aiResult = await aiClient.chat({
        messages: llmMessages,
        systemPrompt: finalSystemPrompt,
        tools: mergedTools,
        toolChoice: mergedTools ? "auto" : "none",
        toolExecutor,
      });

      const finalResponse = await orchestrator.afterLLMCall(aiResult.content);
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
      console.error(error);
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
