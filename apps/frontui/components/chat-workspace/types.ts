import type { Conversation, Message } from "@/lib/frontclaw-api";

export type UIMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  pending?: boolean;
  error?: boolean;
  toolEvents?: ToolStreamEvent[];
  activeTools?: string[];
};

export type ToolStreamEvent = {
  type: "start" | "result" | "error";
  toolName: string;
  args?: Record<string, unknown>;
  source?: "tool" | "skill";
  durationMs?: number;
  resultPreview?: string;
  error?: string;
  startedAt?: number;
};

export type ChatWorkspaceProps = {
  conversationId?: string | null;
};

export type { Conversation, Message };
