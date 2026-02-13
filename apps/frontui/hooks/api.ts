import { UIMessage } from "@/components/chat-workspace/types";
import { messageFromStored } from "@/components/chat-workspace/utils";
import {
  API_PREFIX,
  deleteConversation,
  fetchConversations,
  fetchMessages,
} from "@/lib/frontclaw-api";
import {
  useMutation,
  UseMutationOptions,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

export const useFetchConversations = () => {
  return useQuery({ queryKey: ["conversations"], queryFn: fetchConversations });
};

type ConversationMessageOptions = {
  conversationId: string | null;
};

export const useFetchConversationMessages = ({
  conversationId,
}: ConversationMessageOptions) => {
  return useQuery({
    enabled: !!conversationId,
    queryKey: ["conversations/messages", conversationId],
    queryFn: async () => {
      const rows = await fetchMessages(conversationId || "");
      const loaded = rows
        .map(messageFromStored)
        .filter((entry): entry is UIMessage => entry !== null);

      return loaded;
    },
  });
};

type DeleteConversationVars = {
  conversationId: string;
};

export const useDeleteConversation = (
  options: UseMutationOptions<unknown, Error, DeleteConversationVars>,
) => {
  return useMutation({
    ...options,
    mutationFn: async ({ conversationId }: DeleteConversationVars) =>
      await deleteConversation(conversationId),
  });
};

type ChatStreamState = {
  meta?: {
    conversationId: string;
    userMessageId?: string;
  };
  text: string;
  done: boolean;
  error?: string;
  assistantMessageId?: string;
};

const chatStreamKey = (conversationId?: string) => [
  "chat-stream",
  conversationId ?? "new",
];

function parseSSE(chunk: string): {
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

      if (!res.body) {
        throw new Error("No response body");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      let buffer = "";

      const update = (updater: (s: ChatStreamState) => ChatStreamState) => {
        queryClient.setQueryData<ChatStreamState>(
          chatStreamKey(body.conversationId),
          (old = { text: "", done: false }) => updater(old),
        );
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // split SSE frames
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";

        for (const part of parts) {
          const event = parseSSE(part);
          if (!event) continue;

          switch (event.event) {
            case "meta":
              update((s) => ({ ...s, meta: event.data }));
              break;

            case "delta":
              update((s) => ({
                ...s,
                text: s.text + event.data.text,
              }));
              break;

            case "done":
              update((s) => ({
                ...s,
                done: true,
                assistantMessageId: event.data.assistantMessageId,
              }));
              break;

            case "error":
              update((s) => ({
                ...s,
                error: event.data.message,
                done: true,
              }));
              break;
          }
        }
      }
    },
  });
}

export function useChatStreamState(conversationId?: string) {
  return useQuery<ChatStreamState>({
    queryKey: chatStreamKey(conversationId),
    queryFn: () => ({ text: "", done: false }),
    staleTime: Infinity,
  });
}
