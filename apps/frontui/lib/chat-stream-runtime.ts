import { streamChat } from "@/lib/frontclaw-api";
import type { UIMessage } from "@/components/chat-workspace/types";

type StreamState = {
  conversationId?: string;
  messages: UIMessage[];
  isStreaming: boolean;
  errorText: string | null;
};

type Session = {
  keys: Set<string>;
  state: StreamState;
  listeners: Set<() => void>;
};

const DRAFT_KEY = "draft";
const sessionsByKey = new Map<string, Session>();

function keyFor(conversationId?: string | null): string {
  return conversationId || DRAFT_KEY;
}

function notify(session: Session): void {
  // useSyncExternalStore only updates consumers when snapshot identity changes.
  // We mutate internals during streaming, so force a new top-level snapshot here.
  session.state = {
    ...session.state,
    messages: [...session.state.messages],
  };
  for (const listener of session.listeners) {
    listener();
  }
}

function createSession(initialConversationId?: string): Session {
  return {
    keys: new Set(initialConversationId ? [initialConversationId] : [DRAFT_KEY]),
    state: {
      conversationId: initialConversationId,
      messages: [],
      isStreaming: false,
      errorText: null,
    },
    listeners: new Set(),
  };
}

function getOrCreateSession(key: string, conversationId?: string): Session {
  const existing = sessionsByKey.get(key);
  if (existing) return existing;
  const next = createSession(conversationId);
  sessionsByKey.set(key, next);
  return next;
}

function registerKey(session: Session, key: string): void {
  session.keys.add(key);
  sessionsByKey.set(key, session);
}

function removeKey(session: Session, key: string): void {
  session.keys.delete(key);
  if (sessionsByKey.get(key) === session) {
    sessionsByKey.delete(key);
  }
}

export function subscribeStreamState(
  conversationId: string | null | undefined,
  listener: () => void,
): () => void {
  const key = keyFor(conversationId);
  const session = getOrCreateSession(key, conversationId || undefined);
  session.listeners.add(listener);
  return () => {
    session.listeners.delete(listener);
  };
}

export function getStreamState(
  conversationId: string | null | undefined,
): StreamState {
  const key = keyFor(conversationId);
  const session = sessionsByKey.get(key);
  if (!session) {
    return {
      conversationId: conversationId || undefined,
      messages: [],
      isStreaming: false,
      errorText: null,
    };
  }
  return session.state;
}

export function hydrateConversationMessages(
  conversationId: string,
  loadedMessages: UIMessage[],
): void {
  const session = getOrCreateSession(conversationId, conversationId);
  if (session.state.isStreaming) {
    const loadedById = new Set(loadedMessages.map((message) => message.id));
    const merged = [...loadedMessages];
    for (const message of session.state.messages) {
      if (
        !loadedById.has(message.id) &&
        (message.pending || message.error || message.role === "user")
      ) {
        merged.push(message);
      }
    }
    session.state.messages = merged;
  } else {
    session.state.messages = loadedMessages;
  }
  notify(session);
}

export async function startUniversalStream(params: {
  message: string;
  conversationId?: string;
  onConversationResolved?: (conversationId: string) => void;
}): Promise<void> {
  const initialKey = keyFor(params.conversationId);
  const session = getOrCreateSession(initialKey, params.conversationId);
  session.state.errorText = null;
  session.state.isStreaming = true;

  const optimisticUserId = crypto.randomUUID();
  const withoutPending = session.state.messages.filter(
    (entry) => !(entry.role === "assistant" && entry.pending),
  );
  session.state.messages = [
    ...withoutPending,
    {
      id: optimisticUserId,
      role: "user",
      content: params.message,
    },
    {
      id: "assistant-streaming",
      role: "assistant",
      content: "",
      pending: true,
    },
  ];
  notify(session);

  try {
    await streamChat(
      {
        message: params.message,
        conversationId: params.conversationId,
        stream: true,
      },
      {
        onMeta: (payload) => {
          if (payload.conversationId) {
            session.state.conversationId = payload.conversationId;
            registerKey(session, payload.conversationId);
            params.onConversationResolved?.(payload.conversationId);
          }

          if (payload.userMessageId) {
            session.state.messages = session.state.messages.map((entry) =>
              entry.id === optimisticUserId
                ? { ...entry, id: payload.userMessageId as string }
                : entry,
            );
          }
          notify(session);
        },
        onDelta: (payload) => {
          if (!payload.text) return;
          const messages = [...session.state.messages];
          const last = messages[messages.length - 1];
          if (!last || last.role !== "assistant") return;
          messages[messages.length - 1] = {
            ...last,
            content: `${last.content}${payload.text}`,
          };
          session.state.messages = messages;
          notify(session);
        },
        onToolStart: (payload) => {
          const toolName =
            typeof payload.toolName === "string"
              ? payload.toolName
              : "unknown-tool";
          const messages = [...session.state.messages];
          const last = messages[messages.length - 1];
          if (!last || last.role !== "assistant") return;
          const activeTools = new Set(last.activeTools || []);
          activeTools.add(toolName);
          messages[messages.length - 1] = {
            ...last,
            toolEvents: [
              ...(last.toolEvents || []),
              {
                type: "start",
                toolName,
                args: payload.args,
                startedAt: payload.startedAt,
              },
            ],
            activeTools: Array.from(activeTools),
          };
          session.state.messages = messages;
          notify(session);
        },
        onToolResult: (payload) => {
          const toolName =
            typeof payload.toolName === "string"
              ? payload.toolName
              : "unknown-tool";
          const messages = [...session.state.messages];
          const last = messages[messages.length - 1];
          if (!last || last.role !== "assistant") return;
          messages[messages.length - 1] = {
            ...last,
            toolEvents: [
              ...(last.toolEvents || []),
              {
                type: "result",
                toolName,
                source: payload.source,
                durationMs: payload.durationMs,
                resultPreview: payload.resultPreview,
              },
            ],
            activeTools: (last.activeTools || []).filter(
              (name) => name !== toolName,
            ),
          };
          session.state.messages = messages;
          notify(session);
        },
        onToolError: (payload) => {
          const toolName =
            typeof payload.toolName === "string"
              ? payload.toolName
              : "unknown-tool";
          const messages = [...session.state.messages];
          const last = messages[messages.length - 1];
          if (!last || last.role !== "assistant") return;
          messages[messages.length - 1] = {
            ...last,
            toolEvents: [
              ...(last.toolEvents || []),
              {
                type: "error",
                toolName,
                durationMs: payload.durationMs,
                error: payload.error,
              },
            ],
            activeTools: (last.activeTools || []).filter(
              (name) => name !== toolName,
            ),
          };
          session.state.messages = messages;
          notify(session);
        },
        onDone: (payload) => {
          const messages = [...session.state.messages];
          const last = messages[messages.length - 1];
          if (last?.role === "assistant") {
            messages[messages.length - 1] = {
              ...last,
              id: payload.assistantMessageId || last.id,
              content:
                typeof payload.response === "string" && payload.response.length > 0
                  ? payload.response
                  : last.content,
              pending: false,
              activeTools: [],
            };
          }
          session.state.messages = messages;
          session.state.isStreaming = false;
          notify(session);
          if (session.state.conversationId) {
            removeKey(session, DRAFT_KEY);
          }
        },
        onError: (payload) => {
          session.state.errorText =
            payload.message || payload.error || "Streaming failed";
          session.state.messages = session.state.messages.map((entry, index) => {
            if (
              index === session.state.messages.length - 1 &&
              entry.role === "assistant"
            ) {
              return {
                ...entry,
                pending: false,
                error: true,
                activeTools: [],
              };
            }
            return entry;
          });
          session.state.isStreaming = false;
          notify(session);
        },
      },
    );
  } catch (error) {
    session.state.errorText =
      (error as Error).message || "Failed to stream response";
    session.state.messages = session.state.messages.map((entry, index) => {
      if (index === session.state.messages.length - 1 && entry.role === "assistant") {
        return {
          ...entry,
          pending: false,
          error: true,
          activeTools: [],
        };
      }
      return entry;
    });
    session.state.isStreaming = false;
    notify(session);
    throw error;
  } finally {
    session.state.isStreaming = false;
    notify(session);
  }
}
