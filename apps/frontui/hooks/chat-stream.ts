import type { UIMessage } from "@/components/chat-workspace/types";
import { API_PREFIX } from "@/lib/frontclaw-api";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export type ChatMessage = UIMessage;

export type ChatThreadState = {
  conversationId?: string;
  streamId?: string;
  streamCursor?: number;
  messages: ChatMessage[];
  error?: string;
};

type SSEEvent = {
  id?: number;
  event: string;
  data: unknown;
};

type ActiveStreamRecord = {
  streamId: string;
  cursor: number;
  updatedAt: number;
};

const ACTIVE_STREAMS_STORAGE_KEY = "frontclaw:active-streams";

export const chatThreadKey = (conversationId?: string) =>
  ["chat-thread", conversationId ?? "new"] as const;

const initialState: ChatThreadState = {
  messages: [],
};

function readActiveStreams(): Record<string, ActiveStreamRecord> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(ACTIVE_STREAMS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, ActiveStreamRecord>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeActiveStreams(data: Record<string, ActiveStreamRecord>): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(ACTIVE_STREAMS_STORAGE_KEY, JSON.stringify(data));
}

function saveActiveStream(
  conversationId: string,
  streamId: string,
  cursor: number,
): void {
  const all = readActiveStreams();
  all[conversationId] = { streamId, cursor, updatedAt: Date.now() };
  writeActiveStreams(all);
}

function clearActiveStream(conversationId: string): void {
  const all = readActiveStreams();
  if (!(conversationId in all)) return;
  delete all[conversationId];
  writeActiveStreams(all);
}

export function getActiveStreamForConversation(
  conversationId: string,
): { streamId: string; cursor: number } | null {
  const all = readActiveStreams();
  const row = all[conversationId];
  if (!row?.streamId) return null;
  return { streamId: row.streamId, cursor: row.cursor || 0 };
}

export function parseSSE(chunk: string): SSEEvent | null {
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

  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    parsed = { value: data };
  }

  return {
    id,
    event,
    data: parsed,
  };
}

function updateLastAssistant(
  state: ChatThreadState,
  updater: (message: UIMessage) => UIMessage,
): ChatThreadState {
  const messages = [...state.messages];
  const last = messages[messages.length - 1];
  if (!last || last.role !== "assistant") return state;
  messages[messages.length - 1] = updater(last);
  return { ...state, messages };
}

async function consumeChatSSE(params: {
  response: Response;
  queryClient: ReturnType<typeof useQueryClient>;
  initialConversationId?: string;
  draftBodyMessage?: string;
  ensurePendingAssistant?: boolean;
}): Promise<void> {
  const {
    response,
    queryClient,
    initialConversationId,
    draftBodyMessage,
    ensurePendingAssistant = false,
  } = params;

  let currentConversationId = initialConversationId;
  let activeStreamId: string | undefined;
  let streamCursor = 0;
  const getActiveKey = () => chatThreadKey(currentConversationId);
  const setThreadData = (
    updater: (state: ChatThreadState) => ChatThreadState,
  ) => {
    queryClient.setQueryData<ChatThreadState>(
      getActiveKey(),
      (old = initialState) => updater(old),
    );
  };

  if (ensurePendingAssistant) {
    setThreadData((state) => {
      const hasPendingAssistant = state.messages.some(
        (message) => message.role === "assistant" && message.pending,
      );
      if (hasPendingAssistant) return state;
      return {
        ...state,
        messages: [
          ...state.messages,
          {
            id: "assistant-streaming",
            role: "assistant",
            content: "",
            pending: true,
          },
        ],
      };
    });
  } else if (draftBodyMessage) {
    queryClient.setQueryData<ChatThreadState>(
      chatThreadKey(initialConversationId),
      (old = initialState) => {
        const optimisticUserId = crypto.randomUUID();
        const withoutStalePending = old.messages.filter(
          (message) => !(message.role === "assistant" && message.pending),
        );
        return {
          ...old,
          messages: [
            ...withoutStalePending,
            {
              id: optimisticUserId,
              role: "user",
              content: draftBodyMessage,
            },
            {
              id: "assistant-streaming",
              role: "assistant",
              content: "",
              pending: true,
            },
          ],
        };
      },
    );
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("No response body");
  }
  const decoder = new TextDecoder();

  let buffer = "";
  let tokenBuffer = "";

  const flushTokens = () => {
    if (!tokenBuffer) return;

    setThreadData((s = initialState) => {
      const messages = [...s.messages];
      const last = messages[messages.length - 1];

      if (last?.role === "assistant") {
        messages[messages.length - 1] = {
          ...last,
          content: last.content + tokenBuffer,
        };
      } else {
        messages.push({
          id: "assistant-streaming",
          role: "assistant",
          content: tokenBuffer,
          pending: true,
        });
      }

      return { ...s, messages };
    });

    tokenBuffer = "";
  };

  const flushInterval = setInterval(flushTokens, 30);

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";

      for (const part of parts) {
        const evt = parseSSE(part);
        if (!evt) continue;
        const data = (evt.data ?? {}) as Record<string, unknown>;

        if (typeof evt.id === "number") {
          streamCursor = Math.max(streamCursor, evt.id);
        }

        switch (evt.event) {
          case "meta": {
            const metaConversationId =
              typeof data.conversationId === "string"
                ? data.conversationId
                : undefined;
            const previousConversationId = currentConversationId;

            if (metaConversationId && metaConversationId !== currentConversationId) {
              const previousKey = chatThreadKey(currentConversationId);
              const nextKey = chatThreadKey(metaConversationId);
              const previousState =
                queryClient.getQueryData<ChatThreadState>(previousKey);
              if (previousState) {
                queryClient.setQueryData<ChatThreadState>(
                  nextKey,
                  (existing) => existing ?? previousState,
                );
              }
              currentConversationId = metaConversationId;
            }

            if (!initialConversationId) {
              queryClient.setQueryData<ChatThreadState>(
                chatThreadKey(previousConversationId),
                (s = initialState) => ({
                  ...s,
                  conversationId:
                    typeof data.conversationId === "string"
                      ? data.conversationId
                      : s.conversationId,
                }),
              );
            }

            setThreadData((s = initialState) => ({
              ...s,
              conversationId:
                typeof data.conversationId === "string"
                  ? data.conversationId
                  : s.conversationId,
              streamId:
                typeof data.streamId === "string" ? data.streamId : s.streamId,
              streamCursor: streamCursor || s.streamCursor,
              messages:
                typeof data.userMessageId === "string" && s.messages.length
                  ? s.messages.map((message, index) => {
                      if (
                        index === s.messages.length - 2 &&
                        message.role === "user"
                      ) {
                        return {
                          ...message,
                          id: data.userMessageId as string,
                        };
                      }
                      return message;
                    })
                  : s.messages,
            }));

            if (typeof data.streamId === "string") {
              activeStreamId = data.streamId;
            }
            if (
              currentConversationId &&
              typeof currentConversationId === "string" &&
              activeStreamId
            ) {
              saveActiveStream(currentConversationId, activeStreamId, streamCursor);
            }
            break;
          }

          case "delta":
            if (typeof data.text === "string") {
              tokenBuffer += data.text;
            }
            break;

          case "tool_start":
            flushTokens();
            setThreadData((s = initialState) =>
              updateLastAssistant(s, (last) => {
                const toolName =
                  typeof data.toolName === "string"
                    ? data.toolName
                    : "unknown-tool";
                const activeTools = new Set(last.activeTools || []);
                activeTools.add(toolName);
                return {
                  ...last,
                  toolEvents: [
                    ...(last.toolEvents || []),
                    {
                      type: "start",
                      toolName,
                      args:
                        data.args && typeof data.args === "object"
                          ? (data.args as Record<string, unknown>)
                          : undefined,
                      startedAt:
                        typeof data.startedAt === "number"
                          ? data.startedAt
                          : undefined,
                    },
                  ],
                  activeTools: Array.from(activeTools),
                };
              }),
            );
            break;

          case "tool_result":
            flushTokens();
            setThreadData((s = initialState) =>
              updateLastAssistant(s, (last) => {
                const toolName =
                  typeof data.toolName === "string"
                    ? data.toolName
                    : "unknown-tool";
                const activeTools = (last.activeTools || []).filter(
                  (name) => name !== toolName,
                );
                return {
                  ...last,
                  toolEvents: [
                    ...(last.toolEvents || []),
                    {
                      type: "result",
                      toolName,
                      source: data.source === "skill" ? "skill" : "tool",
                      durationMs:
                        typeof data.durationMs === "number"
                          ? data.durationMs
                          : undefined,
                      resultPreview:
                        typeof data.resultPreview === "string"
                          ? data.resultPreview
                          : undefined,
                    },
                  ],
                  activeTools,
                };
              }),
            );
            break;

          case "tool_error":
            flushTokens();
            setThreadData((s = initialState) =>
              updateLastAssistant(s, (last) => {
                const toolName =
                  typeof data.toolName === "string"
                    ? data.toolName
                    : "unknown-tool";
                const activeTools = (last.activeTools || []).filter(
                  (name) => name !== toolName,
                );
                return {
                  ...last,
                  toolEvents: [
                    ...(last.toolEvents || []),
                    {
                      type: "error",
                      toolName,
                      durationMs:
                        typeof data.durationMs === "number"
                          ? data.durationMs
                          : undefined,
                      error:
                        typeof data.error === "string"
                          ? data.error
                          : "Tool execution failed",
                    },
                  ],
                  activeTools,
                };
              }),
            );
            break;

          case "done":
            flushTokens();
            setThreadData((s = initialState) => {
              const messages = [...s.messages];
              const last = messages[messages.length - 1];

              if (last?.role === "assistant") {
                messages[messages.length - 1] = {
                  ...last,
                  id:
                    typeof data.assistantMessageId === "string"
                      ? data.assistantMessageId
                      : last.id,
                  pending: false,
                  activeTools: [],
                };
              }

              return { ...s, messages, streamCursor };
            });
            if (currentConversationId) {
              clearActiveStream(currentConversationId);
            }
            break;

          case "error":
            setThreadData((s = initialState) => ({
              ...s,
              error:
                typeof data.message === "string"
                  ? data.message
                  : "Streaming error",
              streamCursor,
              messages: s.messages.map((message, index) => {
                if (
                  index === s.messages.length - 1 &&
                  message.role === "assistant"
                ) {
                  return {
                    ...message,
                    pending: false,
                    error: true,
                    activeTools: [],
                  };
                }
                return message;
              }),
            }));
            if (currentConversationId) {
              clearActiveStream(currentConversationId);
            }
            break;
        }

        if (currentConversationId && activeStreamId) {
          saveActiveStream(currentConversationId, activeStreamId, streamCursor);
        }
      }
    }
  } finally {
    clearInterval(flushInterval);
  }
}

export function useChatStream() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (body: {
      message: string;
      conversationId?: string;
      profileId?: string;
    }) => {
      const res = await fetch(`${API_PREFIX}/api/v1/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        const message =
          payload && typeof payload === "object" && "message" in payload
            ? String((payload as { message?: unknown }).message)
            : `Chat request failed (${res.status})`;
        throw new Error(message);
      }

      const contentType = res.headers.get("content-type") || "";
      if (!contentType.includes("text/event-stream")) {
        const payload = await res.json().catch(() => null);
        const message =
          payload && typeof payload === "object" && "message" in payload
            ? String((payload as { message?: unknown }).message)
            : "Unexpected non-stream response from chat endpoint";
        throw new Error(message);
      }

      await consumeChatSSE({
        response: res,
        queryClient,
        initialConversationId: body.conversationId,
        draftBodyMessage: body.message,
      });
    },
  });
}

export function useResumeChatStream() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      conversationId: string;
      streamId: string;
      cursor?: number;
    }) => {
      const cursor = input.cursor ?? 0;
      const res = await fetch(
        `${API_PREFIX}/api/v1/chat/streams/${encodeURIComponent(input.streamId)}?cursor=${cursor}`,
        {
          method: "GET",
          headers: {
            Accept: "text/event-stream",
          },
        },
      );

      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        const message =
          payload && typeof payload === "object" && "message" in payload
            ? String((payload as { message?: unknown }).message)
            : `Resume request failed (${res.status})`;
        throw new Error(message);
      }

      await consumeChatSSE({
        response: res,
        queryClient,
        initialConversationId: input.conversationId,
        ensurePendingAssistant: true,
      });
    },
  });
}

export function useChatThread(conversationId?: string) {
  return useQuery<ChatThreadState>({
    queryKey: chatThreadKey(conversationId),
    queryFn: () => ({ messages: [] }),
    staleTime: Infinity,
  });
}
