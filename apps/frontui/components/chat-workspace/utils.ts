import type { Conversation, Message } from "@/lib/frontclaw-api";
import type { UIMessage } from "./types";

function readStoredToolEvents(metadata: unknown): UIMessage["toolEvents"] {
  if (!metadata || typeof metadata !== "object") return undefined;
  const value = (metadata as { toolEvents?: unknown }).toolEvents;
  if (!Array.isArray(value)) return undefined;

  const normalized = value
    .map((event) => {
      if (!event || typeof event !== "object") return null;
      const candidate = event as Record<string, unknown>;
      const type = candidate.type;
      if (type !== "start" && type !== "result" && type !== "error") {
        return null;
      }
      const eventType: "start" | "result" | "error" = type;
      const sourceValue: "tool" | "skill" | undefined =
        candidate.source === "tool" || candidate.source === "skill"
          ? candidate.source
          : undefined;

      return {
        type: eventType,
        toolName:
          typeof candidate.toolName === "string"
            ? candidate.toolName
            : undefined,
        args:
          candidate.args && typeof candidate.args === "object"
            ? (candidate.args as Record<string, unknown>)
            : undefined,
        source: sourceValue,
        durationMs:
          typeof candidate.durationMs === "number"
            ? candidate.durationMs
            : undefined,
        resultPreview:
          typeof candidate.resultPreview === "string"
            ? candidate.resultPreview
            : undefined,
        error:
          typeof candidate.error === "string" ? candidate.error : undefined,
        startedAt:
          typeof candidate.startedAt === "number"
            ? candidate.startedAt
            : undefined,
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

  return normalized.length > 0 ? normalized : undefined;
}

export function messageFromStored(entry: Message): UIMessage | null {
  if (entry.role !== "user" && entry.role !== "assistant") {
    return null;
  }
  return {
    id: entry.id,
    role: entry.role,
    content: entry.content,
    toolEvents: readStoredToolEvents(entry.metadata),
  };
}

export function conversationTitle(conversation: Conversation): string {
  if (conversation.title && conversation.title.trim().length > 0) {
    return conversation.title.trim();
  }
  return "Untitled conversation";
}

export function relativeTime(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export type ConversationGroup = "recent" | "yesterday" | "past";

export function getConversationGroup(
  updatedAt: string | null,
): ConversationGroup {
  if (!updatedAt) return "past";
  const date = new Date(updatedAt);
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setHours(0, 0, 0, 0);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  if (date >= today) {
    return "recent";
  } else if (date >= yesterday) {
    return "yesterday";
  }
  return "past";
}

export function groupConversations(
  conversations: Conversation[],
): Map<ConversationGroup, Conversation[]> {
  const groups: Map<ConversationGroup, Conversation[]> = new Map([
    ["recent", []],
    ["yesterday", []],
    ["past", []],
  ]);

  for (const conversation of conversations) {
    const group = getConversationGroup(conversation.updatedAt);
    groups.get(group)!.push(conversation);
  }

  for (const group of groups.keys()) {
    groups
      .get(group)!
      .sort(
        (a, b) =>
          new Date(b.updatedAt || 0).getTime() -
          new Date(a.updatedAt || 0).getTime(),
      );
  }

  return groups;
}
