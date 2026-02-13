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
};

export type ChatStreamHandlers = {
  onMeta?: (payload: ChatStreamMeta) => void;
  onDelta?: (payload: { text?: string }) => void;
  onDone?: (payload: ChatStreamDone) => void;
  onError?: (payload: { message?: string; error?: string }) => void;
};

export const API_PREFIX = "/api/frontclaw" as const;

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

  const emitEvent = (raw: string) => {
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

    const parsed = dataLines.length > 0 ? safeParse(dataLines.join("\n")) : {};

    if (eventName === "meta") handlers.onMeta?.(parsed as ChatStreamMeta);
    if (eventName === "delta") handlers.onDelta?.(parsed as { text?: string });
    if (eventName === "done") handlers.onDone?.(parsed as ChatStreamDone);
    if (eventName === "error") {
      handlers.onError?.(parsed as { message?: string; error?: string });
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const chunk = buffer.slice(0, boundary).trim();
      if (chunk) emitEvent(chunk);
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf("\n\n");
    }
  }

  const tail = buffer.trim();
  if (tail) emitEvent(tail);
}

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return { value };
  }
}
