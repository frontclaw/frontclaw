"use client";

import { useFetchConversationMessages } from "@/hooks/api";
import {
  chatThreadKey,
  useChatStream,
  useChatThread,
} from "@/hooks/chat-stream";
import { cloneConversation, submitFeedback } from "@/lib/frontclaw-api";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowDown, Loader2 } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChatComposer } from "./chat-composer";
import { ChatMessage } from "./chat-message";
import { ChatEmptyState } from "./empty-state";
import type { ChatWorkspaceProps } from "./types";

export function ChatWorkspace({ conversationId }: ChatWorkspaceProps) {
  const routedConversationId = conversationId ?? null;
  const [hasMessages, setHasMessages] = useState(false);
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [clonedConversationId, setClonedConversationId] = useState<
    string | null
  >(null);

  const { data: messages, isLoading } = useFetchConversationMessages({
    conversationId: routedConversationId,
  });

  const { data } = useChatThread(conversationId || undefined);
  const mutatePrompt = useChatStream();

  const [composerValue, setComposerValue] = useState("");
  const [errorText, setErrorText] = useState<string | null>(null);
  const lastElemRef = useRef<HTMLDivElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  const shareMode = searchParams.get("share");
  const sharedMessageId = searchParams.get("messageId");
  const isSharedView =
    (shareMode === "message" || shareMode === "conversation") &&
    !!conversationId;

  useEffect(() => {
    if (!routedConversationId || !messages) return;

    queryClient.setQueryData(
      chatThreadKey(routedConversationId),
      (oldData: { messages?: typeof messages } = {}) => {
        if (!messages.length) {
          return {
            ...oldData,
            conversationId: routedConversationId,
            messages: [],
          };
        }

        if (!oldData.messages || oldData.messages.length === 0) {
          return {
            ...oldData,
            conversationId: routedConversationId,
            messages,
          };
        }

        const loadedById = new Set(messages.map((message) => message.id));
        const merged = [...messages];

        for (const message of oldData.messages) {
          if (
            !loadedById.has(message.id) &&
            (message.pending || message.error || message.role === "user")
          ) {
            merged.push(message);
          }
        }

        return {
          ...oldData,
          conversationId: routedConversationId,
          messages: merged,
        };
      },
    );
  }, [messages, queryClient, routedConversationId]);

  const visibleMessages = useMemo(() => {
    if (!data?.messages) return [];
    if (shareMode !== "message" || !sharedMessageId) {
      return data.messages;
    }

    const sharedIndex = data.messages.findIndex(
      (message) => message.id === sharedMessageId,
    );
    if (sharedIndex === -1) {
      return data.messages;
    }
    return data.messages.slice(0, sharedIndex + 1);
  }, [data?.messages, shareMode, sharedMessageId]);

  useEffect(() => {
    setHasMessages(!!visibleMessages.length);
  }, [visibleMessages.length]);

  const lastMessageSignature = useMemo(() => {
    if (!visibleMessages.length) return "";
    const last = visibleMessages[visibleMessages.length - 1];
    if (!last) return "";

    return `${last.id}:${last.content.length}:${last.pending ? "pending" : "done"}`;
  }, [visibleMessages]);

  const isNearBottom = () => {
    const container = scrollContainerRef.current;
    if (!container) return false;

    const threshold = 120; // px tolerance
    return (
      container.scrollHeight - container.scrollTop - container.clientHeight <
      threshold
    );
  };

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const observer = new ResizeObserver(() => {
      if (isNearBottom()) {
        lastElemRef.current?.scrollIntoView({ behavior: "auto" });
      }
    });

    observer.observe(container);

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visibleMessages.length) return;

    lastElemRef.current?.scrollIntoView({ behavior: "auto" });
  }, [lastMessageSignature, visibleMessages.length]);

  useEffect(() => {
    if (data?.error) {
      setErrorText(data.error);
      return;
    }

    if (mutatePrompt.error) {
      setErrorText(mutatePrompt.error.message);
      return;
    }

    setErrorText(null);
  }, [data?.error, mutatePrompt.error]);

  const buildShareUrl = (
    type: "message" | "conversation",
    messageId?: string,
  ) => {
    if (typeof window === "undefined" || !conversationId) return "";
    const params = new URLSearchParams();
    params.set("share", type);
    if (messageId) params.set("messageId", messageId);
    return `${window.location.origin}/c/${conversationId}?${params.toString()}`;
  };

  const ensureWritableConversationId = async () => {
    if (!conversationId) return undefined;
    if (!isSharedView) return conversationId;
    if (clonedConversationId) return clonedConversationId;

    const cloned = await cloneConversation(conversationId, {
      messageId:
        shareMode === "message" ? (sharedMessageId ?? undefined) : undefined,
    });
    setClonedConversationId(cloned.id);
    router.replace(`/c/${cloned.id}`);
    return cloned.id;
  };

  const sendMessage = async (message: string) => {
    const trimmed = message.trim();
    if (!trimmed) return;
    lastElemRef.current?.scrollIntoView();
    const targetConversationId = await ensureWritableConversationId();
    mutatePrompt.mutateAsync({
      message: trimmed,
      conversationId: targetConversationId || undefined,
    });
  };

  const handleCopy = async (text: string) => {
    if (!text) return;
    await navigator.clipboard.writeText(text);
  };

  const handleShare = async (
    type: "message" | "conversation",
    messageId?: string,
  ) => {
    const url = buildShareUrl(type, messageId);
    if (!url) return;
    if (navigator.share) {
      try {
        await navigator.share({ url });
        return;
      } catch {
        // fall back to clipboard
      }
    }
    await navigator.clipboard.writeText(url);
  };

  const handleFeedback = async (score: number, messageId?: string) => {
    if (!conversationId || !messageId) return;
    await submitFeedback({
      conversationId,
      messageId,
      score,
      metadata: { source: "frontui" },
    });
  };

  const handleRetry = async (assistantMessageId: string) => {
    const entries = data?.messages ?? [];
    const index = entries.findIndex((entry) => entry.id === assistantMessageId);
    if (index <= 0) return;
    for (let i = index - 1; i >= 0; i -= 1) {
      if (entries?.[i]?.role === "user") {
        const msg = entries?.[i]?.content as string;
        await sendMessage(msg);
        return;
      }
    }
  };

  return (
    <section className="w-full relative h-screen flex flex-col">
      <div className="flex-1 overflow-y-auto w-full relative flex min-w-0 flex-col border-l border-[var(--frontui-line)] bg-[rgba(255,252,247,0.4)] lg:min-h-[calc(100dvh-4rem)]">
        <div
          ref={scrollContainerRef}
          className="flex-1 overflow-y-auto px-4 py-5 md:px-7"
        >
          {isLoading ? (
            <div className="flex h-full items-center justify-center text-sm text-[var(--frontui-muted)]">
              <Loader2 className="mr-2 animate-spin" size={16} /> Loading
              messages...
            </div>
          ) : visibleMessages.length === 0 ? (
            <div className="mt-40">
              <ChatEmptyState />
            </div>
          ) : (
            <div className="mx-auto max-w-3xl space-y-4 pt-10 pb-28">
              {visibleMessages.map((entry) => (
                <ChatMessage
                  key={entry.id}
                  message={entry}
                  disableActions={!!entry.pending}
                  onCopy={
                    entry.role === "assistant"
                      ? () => handleCopy(entry.content)
                      : undefined
                  }
                  onThumbUp={
                    entry.role === "assistant"
                      ? () => handleFeedback(1, entry.id)
                      : undefined
                  }
                  onThumbDown={
                    entry.role === "assistant"
                      ? () => handleFeedback(-1, entry.id)
                      : undefined
                  }
                  onShareMessage={() => handleShare("message", entry.id)}
                  onShareConversation={
                    conversationId
                      ? () => handleShare("conversation")
                      : undefined
                  }
                  onRetry={
                    entry.role === "assistant"
                      ? () => handleRetry(entry.id)
                      : undefined
                  }
                />
              ))}

              {/* Last element */}
              {visibleMessages.length > 0 && <div ref={lastElemRef} />}
            </div>
          )}
        </div>
      </div>

      {/* Prompt container */}
      <div className="relative w-full">
        {!true ? (
          <button
            type="button"
            onClick={() => {
              lastElemRef.current?.scrollIntoView({ behavior: "smooth" });
            }}
            className="absolute bottom-16 right-6 mb-3 inline-flex h-10 w-10 items-center justify-center rounded-full border border-[var(--frontui-line)] bg-white text-[var(--frontui-ink)] shadow-md transition hover:bg-[rgba(0,0,0,0.04)]"
            aria-label="Scroll to latest"
          >
            <ArrowDown size={18} />
          </button>
        ) : null}
        <ChatComposer
          value={composerValue}
          onChange={setComposerValue}
          onSend={async () => {
            const message = composerValue.trim();
            if (!message) return;
            setComposerValue("");
            await sendMessage(message);
          }}
          sending={mutatePrompt.isPending}
          errorText={errorText}
        />
      </div>
    </section>
  );
}
