export type Conversation = {
  id: string;
  profileId: string | null;
  title: string | null;
  metadata: unknown;
  createdAt: string | null;
  updatedAt: string | null;
};

export type Message = {
  id: string;
  conversationId: string;
  role: string;
  content: string;
  toolName: string | null;
  toolCallId: string | null;
  metadata: unknown;
  createdAt: string | null;
};

export type ConversationContextMetrics = {
  estimatedPromptTokens: number;
  contextWindowLimit: number;
  tokensRemaining: number;
  utilizationRatio: number;
  compactWhenTokensReach: number;
  tokensUntilCompaction: number;
  autoCompact: boolean;
  preserveRecentMessages: number;
  historyMessageCount: number;
};

export type PluginInfo = {
  id: string;
  name?: string;
  version?: string;
  description?: string;
  priority?: number;
  runtime?: string;
  permissions?: unknown;
  tags?: string[];
  manifest?: Record<string, unknown>;
  enabled: boolean;
  active: boolean;
};

export type FrontclawConfig = {
  version?: string;
  project?: {
    name?: string;
    environment?: string;
  };
  ai_models?: {
    chat?: {
      provider?: string;
      model?: string;
      system_prompt?: string;
      api_key?: string;
      base_url?: string;
    };
    embeddings?: {
      provider?: string;
      model?: string;
      api_key?: string;
      base_url?: string;
    };
  };
  database?: Record<string, unknown>;
  features?: Record<string, unknown>;
  embedded_box?: Record<string, unknown>;
  webhooks?: Record<string, unknown>;
  context_management?: {
    context_window_limit?: number;
    compact_when_tokens_reach?: number;
    compact_when_ratio?: number;
    auto_compact?: boolean;
    preserve_recent_messages?: number;
    target_ratio_after_compact?: number;
  };
};

export type ChatStreamMeta = {
  conversationId?: string;
  userMessageId?: string;
};

export type ChatStreamDone = {
  conversationId?: string;
  userMessageId?: string;
  assistantMessageId?: string;
  response?: string;
  toolCalls?: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  }>;
  contextCompaction?: {
    compacted: boolean;
    reason: "auto" | "manual";
    beforeTokens: number;
    afterTokens: number;
    deletedMessages: number;
    preservedMessages: number;
    summaryMessageId?: string;
  };
};

export type ChatStreamHandlers = {
  onMeta?: (payload: ChatStreamMeta) => void;
  onDelta?: (payload: { text?: string }) => void;
  onToolStart?: (payload: {
    toolName?: string;
    args?: Record<string, unknown>;
    startedAt?: number;
  }) => void;
  onToolResult?: (payload: {
    toolName?: string;
    source?: "tool" | "skill";
    durationMs?: number;
    resultPreview?: string;
  }) => void;
  onToolError?: (payload: {
    toolName?: string;
    durationMs?: number;
    error?: string;
  }) => void;
  onDone?: (payload: ChatStreamDone) => void;
  onError?: (payload: { message?: string; error?: string }) => void;
};

export const API_PREFIX = "/api/frontclaw" as const;
type ChatStreamTransport = "sse" | "ws";
const CHAT_TRANSPORT_STORAGE_KEY = "frontclaw:chat-transport";

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_PREFIX}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "message" in payload
        ? String((payload as { message?: unknown }).message)
        : `Request failed (${response.status})`;
    throw new Error(message);
  }

  return payload as T;
}

export async function fetchConversations(): Promise<Conversation[]> {
  const payload = await requestJson<{
    success: boolean;
    conversations: Conversation[];
  }>("/api/v1/conversations");

  return payload.conversations || [];
}

export async function updateConversationTitle(
  conversationId: string,
  title: string,
): Promise<Conversation> {
  const payload = await requestJson<{
    success: boolean;
    conversation: Conversation;
  }>(`/api/v1/conversations/${conversationId}`, {
    method: "PUT",
    body: JSON.stringify({ title }),
  });

  return payload.conversation;
}

export async function cloneConversation(
  conversationId: string,
  options?: {
    messageId?: string;
    profileId?: string;
    title?: string;
  },
): Promise<Conversation> {
  const payload = await requestJson<{
    success: boolean;
    conversation: Conversation;
  }>(`/api/v1/conversations/${conversationId}/clone`, {
    method: "POST",
    body: JSON.stringify(options ?? {}),
  });

  return payload.conversation;
}

export async function submitFeedback(input: {
  conversationId?: string;
  messageId?: string;
  score: number;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await requestJson<{ success: boolean }>(`/api/v1/feedback`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function deleteConversation(
  conversationId: string,
): Promise<void> {
  await requestJson(`/api/v1/conversations/${conversationId}`, {
    method: "DELETE",
  });
}

export async function fetchMessages(
  conversationId: string,
): Promise<Message[]> {
  const payload = await requestJson<{
    success: boolean;
    messages: Message[];
  }>(`/api/v1/conversations/${conversationId}/messages`);

  return payload.messages || [];
}

export async function compactConversation(
  conversationId: string,
  options?: { force?: boolean; preserveRecentMessages?: number },
): Promise<{
  compacted: boolean;
  result: {
    compacted: boolean;
    reason: "auto" | "manual";
    beforeTokens: number;
    afterTokens: number;
    deletedMessages: number;
    preservedMessages: number;
    summaryMessageId?: string;
  };
}> {
  const payload = await requestJson<{
    success: boolean;
    compacted: boolean;
    result: {
      compacted: boolean;
      reason: "auto" | "manual";
      beforeTokens: number;
      afterTokens: number;
      deletedMessages: number;
      preservedMessages: number;
      summaryMessageId?: string;
    };
  }>(`/api/v1/conversations/${conversationId}/compact`, {
    method: "POST",
    body: JSON.stringify(options ?? {}),
  });

  return {
    compacted: payload.compacted,
    result: payload.result,
  };
}

export async function fetchConversationMetrics(
  conversationId: string,
  options?: { limit?: number; message?: string; systemPrompt?: string },
): Promise<ConversationContextMetrics> {
  const params = new URLSearchParams();
  if (typeof options?.limit === "number" && Number.isFinite(options.limit)) {
    params.set("limit", String(Math.max(1, Math.floor(options.limit))));
  }
  if (options?.message) params.set("message", options.message);
  if (options?.systemPrompt) params.set("systemPrompt", options.systemPrompt);

  const query = params.toString();
  const payload = await requestJson<{
    success: boolean;
    metrics: ConversationContextMetrics;
  }>(
    `/api/v1/conversations/${conversationId}/metrics${query ? `?${query}` : ""}`,
  );

  return payload.metrics;
}

export async function fetchConfig(): Promise<FrontclawConfig> {
  const payload = await requestJson<{
    success: boolean;
    configs: FrontclawConfig;
  }>("/api/v1/config");

  return payload.configs;
}

export async function saveConfig(config: FrontclawConfig): Promise<void> {
  await requestJson("/api/v1/config", {
    method: "POST",
    body: JSON.stringify(config),
  });
}

export async function fetchPlugins(): Promise<PluginInfo[]> {
  const payload = await requestJson<{
    success: boolean;
    plugins: PluginInfo[];
  }>("/api/v1/plugins");

  return payload.plugins || [];
}

export async function setPluginEnabled(
  pluginId: string,
  enabled: boolean,
): Promise<{ id: string; enabled: boolean; active: boolean }> {
  const payload = await requestJson<{
    success: boolean;
    plugin: { id: string; enabled: boolean; active: boolean };
  }>(`/api/v1/plugins/${pluginId}/enabled`, {
    method: "PATCH",
    body: JSON.stringify({ enabled }),
  });

  return payload.plugin;
}

export async function streamChat(
  body: {
    message: string;
    conversationId?: string;
    title?: string;
    stream?: boolean;
    systemPrompt?: string;
  },
  handlers: ChatStreamHandlers,
): Promise<void> {
  const preferred = resolveChatStreamTransport();
  if (preferred === "ws") {
    try {
      await streamChatWS(body, handlers);
      return;
    } catch {
      // Fallback to SSE to preserve compatibility when WS is unavailable.
    }
  }

  await streamChatSSE(body, handlers);
}

async function streamChatSSE(
  body: {
    message: string;
    conversationId?: string;
    title?: string;
    stream?: boolean;
    systemPrompt?: string;
  },
  handlers: ChatStreamHandlers,
): Promise<void> {
  const response = await fetch(`${API_PREFIX}/api/v1/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify({ ...body, stream: true }),
    cache: "no-store",
  });

  if (!response.ok || !response.body) {
    const fallback = await response.json().catch(() => null);
    const message =
      fallback && typeof fallback === "object" && "message" in fallback
        ? String((fallback as { message?: unknown }).message)
        : "Streaming request failed";
    throw new Error(message);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const chunk = buffer.slice(0, boundary).trim();
      if (chunk) {
        const parsed = parseSSEEvent(chunk);
        if (parsed) dispatchChatStreamEvent(parsed.event, parsed.data, handlers);
      }
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf("\n\n");
    }
  }

  const tail = buffer.trim();
  if (tail) {
    const parsed = parseSSEEvent(tail);
    if (parsed) dispatchChatStreamEvent(parsed.event, parsed.data, handlers);
  }
}

async function streamChatWS(
  body: {
    message: string;
    conversationId?: string;
    title?: string;
    stream?: boolean;
    systemPrompt?: string;
  },
  handlers: ChatStreamHandlers,
): Promise<void> {
  const wsUrl = resolveChatWebSocketUrl();
  if (!wsUrl) throw new Error("WebSocket URL is not configured");

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let sawTerminalEvent = false;
    let socket: WebSocket | null = null;

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.close();
      }
      if (error) reject(error);
      else resolve();
    };

    try {
      socket = new WebSocket(wsUrl);
    } catch (error) {
      finish(error as Error);
      return;
    }

    socket.onopen = () => {
      socket?.send(
        JSON.stringify({
          type: "start",
          body: { ...body, stream: true },
        }),
      );
    };

    socket.onmessage = (event) => {
      const parsed = safeParse(
        typeof event.data === "string" ? event.data : String(event.data),
      ) as {
        event?: string;
        data?: unknown;
      };
      if (typeof parsed.event !== "string") return;
      dispatchChatStreamEvent(parsed.event, parsed.data, handlers);
      if (parsed.event === "done" || parsed.event === "error") {
        sawTerminalEvent = true;
      }
    };

    socket.onerror = () => {
      finish(new Error("WebSocket streaming failed"));
    };

    socket.onclose = () => {
      if (!sawTerminalEvent) {
        finish(new Error("WebSocket stream closed before completion"));
        return;
      }
      finish();
    };
  });
}

function resolveChatStreamTransport(): ChatStreamTransport {
  if (typeof window !== "undefined") {
    const stored = window.localStorage.getItem(CHAT_TRANSPORT_STORAGE_KEY);
    if (stored === "ws" || stored === "sse") return stored;
  }
  const env = process.env.NEXT_PUBLIC_FRONTCLAW_CHAT_TRANSPORT;
  if (env === "ws" || env === "sse") return env;
  return "sse";
}

function resolveChatWebSocketUrl(): string | null {
  const configured =
    process.env.NEXT_PUBLIC_FRONTCLAW_WS_BASE ||
    process.env.NEXT_PUBLIC_FRONTCLAW_API_BASE ||
    "http://127.0.0.1:9901";

  try {
    const url = new URL(configured);
    if (url.protocol === "http:") url.protocol = "ws:";
    if (url.protocol === "https:") url.protocol = "wss:";
    if (url.protocol !== "ws:" && url.protocol !== "wss:") return null;
    url.pathname = "/api/v1/chat/ws";
    url.search = "";
    return url.toString();
  } catch {
    return null;
  }
}

function parseSSEEvent(
  raw: string,
): { event: string; data: unknown } | null {
  const lines = raw.split("\n");
  let eventName = "message";
  const dataLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith("event:")) {
      eventName = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trim());
    }
  }

  if (dataLines.length === 0) return null;
  return {
    event: eventName,
    data: safeParse(dataLines.join("\n")),
  };
}

function dispatchChatStreamEvent(
  eventName: string,
  data: unknown,
  handlers: ChatStreamHandlers,
): void {
  if (eventName === "meta") handlers.onMeta?.(data as ChatStreamMeta);
  if (eventName === "delta") handlers.onDelta?.(data as { text?: string });
  if (eventName === "tool_start") {
    handlers.onToolStart?.(
      data as {
        toolName?: string;
        args?: Record<string, unknown>;
        startedAt?: number;
      },
    );
  }
  if (eventName === "tool_result") {
    handlers.onToolResult?.(
      data as {
        toolName?: string;
        source?: "tool" | "skill";
        durationMs?: number;
        resultPreview?: string;
      },
    );
  }
  if (eventName === "tool_error") {
    handlers.onToolError?.(
      data as { toolName?: string; durationMs?: number; error?: string },
    );
  }
  if (eventName === "done") handlers.onDone?.(data as ChatStreamDone);
  if (eventName === "error") {
    handlers.onError?.(data as { message?: string; error?: string });
  }
}

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return { value };
  }
}
