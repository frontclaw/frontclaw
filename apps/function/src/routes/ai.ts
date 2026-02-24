import {
  executeConversationCompactionRequest,
  executeConversationContextRequest,
  executeConversationMetricsRequest,
  normalizeConversationTitle,
  parsePagingValue,
  executeChatRequest,
} from "@workspace/core";
import { primaryActions as pDB } from "@workspace/db";
import type { Hono } from "hono";
import { createScopedLogger } from "../lib/logging";
import {
  createChatStreamSSE,
  hasChatStreamSession,
} from "../services/chat-stream-sessions";
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

type ChatWSRequestMessage = {
  type: "start";
  body: Partial<ChatRequestBody>;
};

type SSEFrame = {
  id?: number;
  event: string;
  data: unknown;
};

function parseSSEFrame(chunk: string): SSEFrame | null {
  let event = "message";
  let data = "";
  let id: number | undefined;

  for (const line of chunk.split("\n")) {
    if (line.startsWith("id:")) {
      const parsed = Number.parseInt(line.slice(3).trim(), 10);
      id = Number.isNaN(parsed) ? undefined : parsed;
    } else if (line.startsWith("event:")) {
      event = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      data += line.slice(5).trim();
    }
  }

  if (!data) return null;

  let parsedData: unknown;
  try {
    parsedData = JSON.parse(data);
  } catch {
    parsedData = { value: data };
  }

  return { id, event, data: parsedData };
}

function toTextMessage(data: string | ArrayBuffer | Uint8Array): string {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  return new TextDecoder().decode(data);
}

export function registerAIRoutes(app: Hono, deps: AIRouteDeps) {
  const {
    orchestrator,
    awaitOrchestratorReady,
    awaitAIReady,
    getAIClient,
    getConfiguredSystemPrompt,
  } = deps;
  const chatLogger = createScopedLogger("chat");

  app.get("/api/v1/chat/streams/:streamId", async (c) => {
    try {
      const streamId = c.req.param("streamId");
      if (!hasChatStreamSession(streamId)) {
        return c.json(
          { success: false, message: "Stream session not found" },
          404,
        );
      }

      const cursorRaw = c.req.query("cursor");
      const cursor = cursorRaw ? Number.parseInt(cursorRaw, 10) : 0;

      return new Response(
        createChatStreamSSE(streamId, Number.isNaN(cursor) ? 0 : cursor),
        {
          status: 200,
          headers: {
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
          },
        },
      );
    } catch (error) {
      return c.json(
        {
          success: false,
          message: "Failed to resume stream",
          error: (error as Error).message,
        },
        500,
      );
    }
  });

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
      const result = await executeConversationContextRequest({
        conversationId: c.req.param("conversationId"),
        query: {
          limit: c.req.query("limit"),
          message: c.req.query("message"),
          systemPrompt: c.req.query("systemPrompt"),
        },
        deps: {
          awaitOrchestratorReady,
          awaitAIReady,
          getConfiguredSystemPrompt,
          getAIClient,
          orchestrator,
          db: {
            getConversation: async (id) => await pDB.getConversation(id),
            getMessages: async (conversationId, options) =>
              await pDB.getMessages(conversationId, options),
            createMessage: async (value) => await pDB.createMessage(value),
            deleteMessagesByIds: async (conversationId, messageIds) =>
              await pDB.deleteMessagesByIds(conversationId, messageIds),
            touchConversation: async (conversationId) =>
              await pDB.touchConversation(conversationId),
          },
        },
      });

      return c.json(
        result.body,
        result.status as 200 | 403 | 404 | 500,
      );
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

  app.get("/api/v1/conversations/:conversationId/metrics", async (c) => {
    try {
      const result = await executeConversationMetricsRequest({
        conversationId: c.req.param("conversationId"),
        query: {
          limit: c.req.query("limit"),
          message: c.req.query("message"),
          systemPrompt: c.req.query("systemPrompt"),
        },
        deps: {
          awaitOrchestratorReady,
          awaitAIReady,
          getConfiguredSystemPrompt,
          getAIClient,
          orchestrator,
          db: {
            getConversation: async (id) => await pDB.getConversation(id),
            getMessages: async (conversationId, options) =>
              await pDB.getMessages(conversationId, options),
            createMessage: async (value) => await pDB.createMessage(value),
            deleteMessagesByIds: async (conversationId, messageIds) =>
              await pDB.deleteMessagesByIds(conversationId, messageIds),
            touchConversation: async (conversationId) =>
              await pDB.touchConversation(conversationId),
          },
        },
      });
      return c.json(result.body, result.status as 200 | 404 | 500);
    } catch (error) {
      return c.json(
        {
          success: false,
          message: "Failed to fetch conversation metrics",
          error: (error as Error).message,
        },
        500,
      );
    }
  });

  app.post("/api/v1/conversations/:conversationId/compact", async (c) => {
    try {
      let body: { force?: boolean; preserveRecentMessages?: number } = {};
      try {
        body = (await c.req.json()) as {
          force?: boolean;
          preserveRecentMessages?: number;
        };
      } catch {
        body = {};
      }

      const result = await executeConversationCompactionRequest({
        conversationId: c.req.param("conversationId"),
        body,
        deps: {
          awaitOrchestratorReady,
          awaitAIReady,
          getConfiguredSystemPrompt,
          getAIClient,
          orchestrator,
          db: {
            getConversation: async (id) => await pDB.getConversation(id),
            getMessages: async (conversationId, options) =>
              await pDB.getMessages(conversationId, options),
            createMessage: async (value) => await pDB.createMessage(value),
            deleteMessagesByIds: async (conversationId, messageIds) =>
              await pDB.deleteMessagesByIds(conversationId, messageIds),
            touchConversation: async (conversationId) =>
              await pDB.touchConversation(conversationId),
          },
        },
      });

      return c.json(result.body, result.status as 200 | 404 | 500);
    } catch (error) {
      return c.json(
        {
          success: false,
          message: "Failed to compact context",
          error: (error as Error).message,
        },
        500,
      );
    }
  });

  app.post("/api/v1/chat", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Partial<ChatRequestBody>;
    try {
      const result = await executeChatRequest({
        body,
        acceptHeader: c.req.header("accept"),
        deps: {
          awaitOrchestratorReady,
          awaitAIReady,
          getAIClient,
          getConfiguredSystemPrompt,
          orchestrator,
          db: {
            getConversation: async (id) => await pDB.getConversation(id),
            createConversation: async (value) =>
              await pDB.createConversation(value),
            getMessages: async (conversationId, options) =>
              await pDB.getMessages(conversationId, options),
            createMessage: async (value) => await pDB.createMessage(value),
            touchConversation: async (conversationId) =>
              await pDB.touchConversation(conversationId),
            setConversationTitle: async (conversationId, title) =>
              await pDB.setConversationTitle(conversationId, title),
            deleteMessagesByIds: async (conversationId, messageIds) =>
              await pDB.deleteMessagesByIds(conversationId, messageIds),
          },
          logger: chatLogger,
        },
      });

      if (result.kind === "stream") {
        return new Response(result.stream, {
          status: 200,
          headers: {
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
          },
        });
      }

      return c.json(result.body, result.status as 200 | 400 | 403 | 404 | 500);
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

  if (deps.upgradeWebSocket) {
    app.get(
      "/api/v1/chat/ws",
      deps.upgradeWebSocket((_c: unknown) => {
        let streamReader: ReadableStreamDefaultReader<Uint8Array> | null = null;

        return {
          onMessage: async (event: any, ws: any) => {
            try {
              const raw = toTextMessage(event.data as string | ArrayBuffer | Uint8Array);
              const parsed = JSON.parse(raw) as ChatWSRequestMessage;
              if (!parsed || parsed.type !== "start") {
                ws.send(
                  JSON.stringify({
                    event: "error",
                    data: { message: "Invalid websocket request type" },
                  }),
                );
                return;
              }

              const result = await executeChatRequest({
                body: parsed.body || {},
                acceptHeader: "text/event-stream",
                deps: {
                  awaitOrchestratorReady,
                  awaitAIReady,
                  getAIClient,
                  getConfiguredSystemPrompt,
                  orchestrator,
                  db: {
                    getConversation: async (id) => await pDB.getConversation(id),
                    createConversation: async (value) =>
                      await pDB.createConversation(value),
                    getMessages: async (conversationId, options) =>
                      await pDB.getMessages(conversationId, options),
                    createMessage: async (value) => await pDB.createMessage(value),
                    touchConversation: async (conversationId) =>
                      await pDB.touchConversation(conversationId),
                    setConversationTitle: async (conversationId, title) =>
                      await pDB.setConversationTitle(conversationId, title),
                    deleteMessagesByIds: async (conversationId, messageIds) =>
                      await pDB.deleteMessagesByIds(conversationId, messageIds),
                  },
                  logger: chatLogger,
                },
              });

              if (result.kind === "json") {
                const payload = result.body as Record<string, unknown>;
                if (result.status >= 400 || payload.success === false) {
                  ws.send(
                    JSON.stringify({
                      event: "error",
                      data: {
                        message:
                          typeof payload.message === "string"
                            ? payload.message
                            : "Chat request failed",
                      },
                    }),
                  );
                } else {
                  const messages =
                    payload.messages && typeof payload.messages === "object"
                      ? (payload.messages as Record<string, unknown>)
                      : null;
                  const user =
                    messages?.user && typeof messages.user === "object"
                      ? (messages.user as Record<string, unknown>)
                      : null;
                  const assistant =
                    messages?.assistant && typeof messages.assistant === "object"
                      ? (messages.assistant as Record<string, unknown>)
                      : null;

                  ws.send(
                    JSON.stringify({
                      event: "meta",
                      data: {
                        conversationId:
                          typeof payload.conversationId === "string"
                            ? payload.conversationId
                            : undefined,
                        userMessageId:
                          typeof user?.id === "string" ? user.id : undefined,
                      },
                    }),
                  );
                  ws.send(
                    JSON.stringify({
                      event: "done",
                      data: {
                        conversationId:
                          typeof payload.conversationId === "string"
                            ? payload.conversationId
                            : undefined,
                        userMessageId:
                          typeof user?.id === "string" ? user.id : undefined,
                        assistantMessageId:
                          typeof assistant?.id === "string"
                            ? assistant.id
                            : undefined,
                        response:
                          typeof payload.response === "string"
                            ? payload.response
                            : undefined,
                      },
                    }),
                  );
                }
                ws.close(1000, "complete");
                return;
              }

              streamReader = result.stream.getReader();
              const decoder = new TextDecoder();
              let buffer = "";

              while (true) {
                const { value, done } = await streamReader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const parts = buffer.split("\n\n");
                buffer = parts.pop() ?? "";

                for (const part of parts) {
                  const frame = parseSSEFrame(part);
                  if (!frame) continue;
                  ws.send(JSON.stringify(frame));
                }
              }

              const tail = buffer.trim();
              if (tail) {
                const frame = parseSSEFrame(tail);
                if (frame) ws.send(JSON.stringify(frame));
              }

              ws.close(1000, "complete");
            } catch (error) {
              ws.send(
                JSON.stringify({
                  event: "error",
                  data: {
                    message: (error as Error).message || "WebSocket chat failed",
                  },
                }),
              );
              ws.close(1011, "error");
            }
          },
          onClose: () => {
            void streamReader?.cancel().catch(() => undefined);
            streamReader = null;
          },
        };
      }),
    );
  }

  app.get("/api/v1/search", async (c) => {
    try {
      await awaitOrchestratorReady();
      await awaitAIReady();
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
