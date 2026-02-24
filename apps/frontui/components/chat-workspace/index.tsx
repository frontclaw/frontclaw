"use client";

import { useFetchConversationMessages } from "@/hooks/api";
import {
  getStreamState,
  hydrateConversationMessages,
  startUniversalStream,
  subscribeStreamState,
} from "@/lib/chat-stream-runtime";
import { cloneConversation, submitFeedback } from "@/lib/frontclaw-api";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowDown, Loader2 } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { ChatComposer } from "./chat-composer";
import { ChatMessage } from "./chat-message";
import { ChatEmptyState } from "./empty-state";
import type { ChatWorkspaceProps } from "./types";

export function ChatWorkspace({ conversationId }: ChatWorkspaceProps) {
  const queryClient = useQueryClient();
  const routedConversationId = conversationId ?? null;
  const searchParams = useSearchParams();
  const router = useRouter();

  const [clonedConversationId, setClonedConversationId] = useState<
    string | null
  >(null);
  const [streamConversationId, setStreamConversationId] = useState<
    string | null
  >(routedConversationId);

  const lastElemRef = useRef<HTMLDivElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  const shareMode = searchParams.get("share");
  const sharedMessageId = searchParams.get("messageId");
  const isSharedView =
    (shareMode === "message" || shareMode === "conversation") &&
    !!conversationId;

  const { data: loadedMessages, isLoading } = useFetchConversationMessages({
    conversationId: routedConversationId,
  });

  const streamState = useSyncExternalStore(
    (listener) =>
      subscribeStreamState(
        streamConversationId || routedConversationId,
        listener,
      ),
    () => getStreamState(streamConversationId || routedConversationId),
    () => getStreamState(streamConversationId || routedConversationId),
  );

  useEffect(() => {
    setStreamConversationId(routedConversationId);
  }, [routedConversationId]);

  useEffect(() => {
    if (!routedConversationId || !loadedMessages) return;
    hydrateConversationMessages(routedConversationId, loadedMessages);
  }, [loadedMessages, routedConversationId]);

  const visibleMessages = useMemo(() => {
    if (shareMode !== "message" || !sharedMessageId) {
      return streamState.messages;
    }

    const sharedIndex = streamState.messages.findIndex(
      (message) => message.id === sharedMessageId,
    );
    if (sharedIndex === -1) {
      return streamState.messages;
    }
    return streamState.messages.slice(0, sharedIndex + 1);
  }, [streamState.messages, shareMode, sharedMessageId]);

  const lastMessageSignature = useMemo(() => {
    if (!visibleMessages.length) return "";
    const last = visibleMessages[visibleMessages.length - 1];
    if (!last) return "";
    return `${last.id}:${last.content.length}:${last.pending ? "pending" : "done"}`;
  }, [visibleMessages]);

  const isNearBottom = () => {
    const container = scrollContainerRef.current;
    if (!container) return false;
    const threshold = 120;
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

  const buildShareUrl = (
    type: "message" | "conversation",
    messageId?: string,
  ) => {
    const targetConversationId = streamConversationId || conversationId;
    if (typeof window === "undefined" || !targetConversationId) return "";
    const params = new URLSearchParams();
    params.set("share", type);
    if (messageId) params.set("messageId", messageId);
    return `${window.location.origin}/c/${targetConversationId}?${params.toString()}`;
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
    if (!trimmed || streamState.isStreaming) return;

    const targetConversationId = await ensureWritableConversationId();

    try {
      await startUniversalStream({
        message: trimmed,
        conversationId: targetConversationId || undefined,
        onConversationResolved: (resolvedConversationId) => {
          setStreamConversationId(resolvedConversationId);

          if (!routedConversationId) {
            // Refresh sidebar conversation list
            void queryClient.invalidateQueries({ queryKey: ["conversations"] });
            router.replace(`/c/${resolvedConversationId}`);
          }
        },
      });
    } catch {
      // state is already set in runtime manager
    }
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
    const targetConversationId = streamConversationId || conversationId;
    if (!targetConversationId || !messageId) return;
    await submitFeedback({
      conversationId: targetConversationId,
      messageId,
      score,
      metadata: { source: "frontui" },
    });
  };

  const handleRetry = async (assistantMessageId: string) => {
    const index = streamState.messages.findIndex(
      (entry) => entry.id === assistantMessageId,
    );
    if (index <= 0) return;
    for (let i = index - 1; i >= 0; i -= 1) {
      const entry = streamState.messages[i];
      if (entry?.role === "user") {
        await sendMessage(entry.content);
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
          {isLoading && !streamState.messages.length ? (
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
                  disableActions={!!entry.pending || streamState.isStreaming}
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
                    streamConversationId || conversationId
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

              {visibleMessages.length > 0 && <div ref={lastElemRef} />}
            </div>
          )}
        </div>
      </div>

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
          defaultValue=""
          onSend={async (prompt) => {
            const message = prompt.trim();
            if (!message) return;
            await sendMessage(message);
          }}
          sending={streamState.isStreaming}
          errorText={streamState.errorText}
        />
      </div>
    </section>
  );
}
