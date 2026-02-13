import type { Conversation, Message } from "@/lib/frontclaw-api";

export type UIMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  pending?: boolean;
  error?: boolean;
};

export type ChatWorkspaceProps = {
  conversationId?: string | null;
};

export type { Conversation, Message };
