import type { UIMessage } from "@/components/chat-workspace/types";
import { API_PREFIX } from "@/lib/frontclaw-api";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export type ChatMessage = UIMessage;

export type ChatThreadState = {
  conversationId?: string;
  messages: ChatMessage[];
  error?: string;
};

export const chatThreadKey = (conversationId?: string) =>
  ["chat-thread", conversationId ?? "new"] as const;

export function parseSSE(chunk: string): {
  event: string;
  data: any;
} | null {
  let event = "message";
  let data = "";

  for (const line of chunk.split("\n")) {
    if (line.startsWith("event:")) {
      event = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      data += line.slice(5).trim();
    }
  }

  if (!data) return null;

  return {
    event,
    data: JSON.parse(data),
  };
}

const initialState: ChatThreadState = {
  messages: [],
};

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

export function useChatStream() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (body: {
      message: string;
      conversationId?: string;
      profileId?: string;
    }) => {
      const key = chatThreadKey(body.conversationId);

      // 1️⃣ seed messages (optimistic)
      queryClient.setQueryData<ChatThreadState>(key, (old = initialState) => {
        const optimisticUserId = crypto.randomUUID();
        return {
          ...old,
          messages: [
            ...old.messages,
            {
              id: optimisticUserId,
              role: "user",
              content: body.message,
            },
            {
              id: "assistant-streaming",
              role: "assistant",
              content: "",
              pending: true,
            },
          ],
        };
      });

      const res = await fetch(`${API_PREFIX}/api/v1/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify(body),
      });

      if (!res.body) {
        throw new Error("No response body");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      let buffer = "";
      let tokenBuffer = "";

      const flushTokens = () => {
        if (!tokenBuffer) return;

        queryClient.setQueryData<ChatThreadState>(key, (s = initialState) => {
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

            switch (evt.event) {
              case "meta":
                queryClient.setQueryData<ChatThreadState>(
                  key,
                  (s = initialState) => ({
                    ...s,
                    conversationId: evt.data.conversationId,
                    messages:
                      evt.data.userMessageId && s.messages.length
                        ? s.messages.map((message, index) => {
                            if (
                              index === s.messages.length - 2 &&
                              message.role === "user"
                            ) {
                              return {
                                ...message,
                                id: evt.data.userMessageId,
                              };
                            }
                            return message;
                          })
                        : s.messages,
                  }),
                );
                break;

              case "delta":
                tokenBuffer += evt.data.text;
                break;

              case "tool_start":
                flushTokens();
                queryClient.setQueryData<ChatThreadState>(
                  key,
                  (s = initialState) =>
                    updateLastAssistant(s, (last) => {
                      const toolName =
                        typeof evt.data.toolName === "string"
                          ? evt.data.toolName
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
                              evt.data.args &&
                              typeof evt.data.args === "object"
                                ? evt.data.args
                                : undefined,
                            startedAt:
                              typeof evt.data.startedAt === "number"
                                ? evt.data.startedAt
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
                queryClient.setQueryData<ChatThreadState>(
                  key,
                  (s = initialState) =>
                    updateLastAssistant(s, (last) => {
                      const toolName =
                        typeof evt.data.toolName === "string"
                          ? evt.data.toolName
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
                            source:
                              evt.data.source === "skill" ? "skill" : "tool",
                            durationMs:
                              typeof evt.data.durationMs === "number"
                                ? evt.data.durationMs
                                : undefined,
                            resultPreview:
                              typeof evt.data.resultPreview === "string"
                                ? evt.data.resultPreview
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
                queryClient.setQueryData<ChatThreadState>(
                  key,
                  (s = initialState) =>
                    updateLastAssistant(s, (last) => {
                      const toolName =
                        typeof evt.data.toolName === "string"
                          ? evt.data.toolName
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
                              typeof evt.data.durationMs === "number"
                                ? evt.data.durationMs
                                : undefined,
                            error:
                              typeof evt.data.error === "string"
                                ? evt.data.error
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
                queryClient.setQueryData<ChatThreadState>(
                  key,
                  (s = initialState) => {
                    const messages = [...s.messages];
                    const last = messages[messages.length - 1];

                    if (last?.role === "assistant") {
                      messages[messages.length - 1] = {
                        ...last,
                        id: evt.data.assistantMessageId,
                        pending: false,
                        activeTools: [],
                      };
                    }

                    return { ...s, messages };
                  },
                );
                break;

              case "error":
                queryClient.setQueryData<ChatThreadState>(
                  key,
                  (s = initialState) => ({
                    ...s,
                    error: evt.data.message,
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
                  }),
                );
                break;
            }
          }
        }
      } finally {
        clearInterval(flushInterval);
      }
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
