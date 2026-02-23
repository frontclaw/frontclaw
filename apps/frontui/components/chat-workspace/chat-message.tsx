"use client";

import { MessageMarkdown } from "@/components/message-markdown";
import { Button } from "@workspace/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { cn } from "@workspace/ui/lib/utils";
import { Copy, RotateCcw, Share2, ThumbsDown, ThumbsUp } from "lucide-react";
import React from "react";
import type { UIMessage } from "./types";

type AssistantContentSegment =
  | { type: "text"; content: string }
  | { type: "think"; content: string };

function parseAssistantContent(content: string): {
  segments: AssistantContentSegment[];
  hasThink: boolean;
} {
  if (!content.includes("<think>")) {
    return {
      segments: content ? [{ type: "text", content }] : [],
      hasThink: false,
    };
  }

  const segments: AssistantContentSegment[] = [];
  let hasThink = false;
  let cursor = 0;

  while (cursor < content.length) {
    const openIdx = content.indexOf("<think>", cursor);
    if (openIdx === -1) {
      const tail = content.slice(cursor);
      if (tail.trim()) {
        segments.push({ type: "text", content: tail });
      }
      break;
    }

    const before = content.slice(cursor, openIdx);
    if (before.trim()) {
      segments.push({ type: "text", content: before });
    }

    hasThink = true;
    const thinkStart = openIdx + "<think>".length;
    const closeIdx = content.indexOf("</think>", thinkStart);

    if (closeIdx === -1) {
      segments.push({
        type: "think",
        content: content.slice(thinkStart).trim(),
      });
      break;
    }

    segments.push({
      type: "think",
      content: content.slice(thinkStart, closeIdx).trim(),
    });
    cursor = closeIdx + "</think>".length;
  }

  return { segments, hasThink };
}

type ChatMessageProps = {
  message: UIMessage;
  onCopy?: () => void;
  onRetry?: () => void;
  onThumbUp?: () => void;
  onThumbDown?: () => void;
  onShareMessage?: () => void;
  onShareConversation?: () => void;
  disableActions?: boolean;
};

export const ChatMessage = React.memo(
  ({
    message,
    onCopy,
    onRetry,
    onThumbUp,
    onThumbDown,
    onShareMessage,
    onShareConversation,
    disableActions,
  }: ChatMessageProps) => {
    const { role, content, pending, error, activeTools, toolEvents } = message;
    const { segments, hasThink } = React.useMemo(
      () => parseAssistantContent(content),
      [content],
    );
    const thoughtStartRef = React.useRef<number | null>(null);
    const sawPendingThoughtRef = React.useRef(false);
    const [thoughtDurationSeconds, setThoughtDurationSeconds] = React.useState<
      number | null
    >(null);

    React.useEffect(() => {
      if (!hasThink) {
        thoughtStartRef.current = null;
        sawPendingThoughtRef.current = false;
        if (thoughtDurationSeconds !== null) {
          setThoughtDurationSeconds(null);
        }
        return;
      }

      if (pending && !sawPendingThoughtRef.current) {
        sawPendingThoughtRef.current = true;
        thoughtStartRef.current = Date.now();
        if (thoughtDurationSeconds !== null) {
          setThoughtDurationSeconds(null);
        }
      }

      if (
        !pending &&
        sawPendingThoughtRef.current &&
        thoughtStartRef.current !== null &&
        thoughtDurationSeconds === null
      ) {
        const elapsedMs = Date.now() - thoughtStartRef.current;
        const seconds = Math.max(1, Math.round(elapsedMs / 1000));
        setThoughtDurationSeconds(seconds);
      }
    }, [hasThink, pending, thoughtDurationSeconds]);

    const containerClass =
      role === "user"
        ? "ml-6 text-[var(--primary)]"
        : error
          ? "mr-6 border border-[#e8c7bd] bg-[#fff2ed] text-[#8c3e21]"
          : "mr-6 border-[var(--frontui-line)] bg-[var(--frontui-surface)] text-[var(--frontui-ink)]";

    return (
      <div
        className={`flex w-full ${
          role === "user" ? "justify-end" : "justify-start"
        }`}
      >
        <div>
          <article
            className={cn(
              `message-enter rounded-2xl border bg-white px-4 py-1 ${containerClass}`,
              role === "assistant" && "bg-transparent border-0 px-0 py-4",
            )}
          >
            {role === "assistant" &&
            (activeTools?.length || toolEvents?.length) ? (
              <div className="mb-3 rounded-lg border border-[var(--frontui-line)] bg-[var(--frontui-surface)] px-3 py-2 text-xs text-[var(--frontui-muted)]">
                {activeTools && activeTools.length > 0 ? (
                  <div className="font-medium text-[var(--frontui-ink)]">
                    Running: {activeTools.join(", ")}
                  </div>
                ) : null}
                {toolEvents && toolEvents.length > 0 ? (
                  <div className="mt-1 space-y-1">
                    {toolEvents.slice(-8).map((event, idx) => (
                      <div
                        key={`${event.type}-${event.toolName}-${idx}`}
                        className={
                          event.type === "error"
                            ? "text-[#b42318] font-medium"
                            : undefined
                        }
                      >
                        {event.type === "start"
                          ? `Calling ${event.toolName || "tool"}...`
                          : null}
                        {event.type === "result"
                          ? `${event.toolName || "tool"} completed${event.durationMs ? ` (${event.durationMs}ms)` : ""}`
                          : null}
                        {event.type === "error"
                          ? `${event.toolName || "tool"} failed: ${event.error || "Unknown error"}`
                          : null}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}

            {role === "assistant" && segments.length > 0 ? (
              <div className="space-y-3">
                {segments.map((segment, idx) =>
                  segment.type === "text" ? (
                    <div key={`text-${idx}`} className="text-[13px] leading-7">
                      <MessageMarkdown content={segment.content} />
                    </div>
                  ) : (
                    <details
                      key={`think-${idx}`}
                      className="rounded-lg border border-[var(--frontui-line)] bg-[var(--frontui-surface)] px-3 py-2"
                    >
                      <summary className="cursor-pointer text-xs font-medium text-[var(--frontui-muted)]">
                        {pending
                          ? "Thinking..."
                          : thoughtDurationSeconds !== null
                            ? `Thought for ${thoughtDurationSeconds}s`
                            : "Thought"}
                      </summary>
                      {segment.content ? (
                        <div className="mt-2 text-xs text-[var(--frontui-ink)]">
                          <MessageMarkdown content={segment.content} />
                        </div>
                      ) : null}
                    </details>
                  ),
                )}
              </div>
            ) : role === "assistant" && pending && !error ? (
              <div className="text-[13px] leading-7">
                <span>Thinking...</span>
              </div>
            ) : (
              <div className="text-[13px] leading-7">
                {content ? <MessageMarkdown content={content} /> : null}
              </div>
            )}

            {pending ? (
              <div className="mt-3 flex items-center gap-1">
                <span className="typing-dot h-1.5 w-1.5 rounded-full bg-[var(--frontui-accent)]" />
                <span className="typing-dot h-1.5 w-1.5 rounded-full bg-[var(--frontui-accent)]" />
                <span className="typing-dot h-1.5 w-1.5 rounded-full bg-[var(--frontui-accent)]" />
              </div>
            ) : null}
          </article>

          {/* Action buttons */}
          {role === "assistant" && (
            <div
              className={cn(
                "mt-3 flex items-center gap-2 text-[12px] text-[var(--frontui-muted)]",
                "justify-start",
              )}
            >
              {onCopy ? (
                <Button
                  type="button"
                  size={"icon"}
                  variant={"outline"}
                  onClick={onCopy}
                  disabled={disableActions}
                  className="rounded-md transition hover:bg-[rgba(0,0,0,0.05)] disabled:opacity-50 border-0 size-7"
                >
                  <Copy size={11} className="size-4" />
                </Button>
              ) : null}

              {onThumbUp ? (
                <Button
                  type="button"
                  size={"icon"}
                  variant={"outline"}
                  onClick={onThumbUp}
                  disabled={disableActions}
                  className="rounded-md transition hover:bg-[rgba(0,0,0,0.05)] disabled:opacity-50 border-0 size-7"
                >
                  <ThumbsUp size={14} className="size-4" />
                </Button>
              ) : null}

              {onThumbDown ? (
                <Button
                  type="button"
                  size={"icon"}
                  variant={"outline"}
                  onClick={onThumbDown}
                  disabled={disableActions}
                  className="rounded-md transition hover:bg-[rgba(0,0,0,0.05)] disabled:opacity-50 border-0 size-7"
                >
                  <ThumbsDown size={14} className="size-4" />
                </Button>
              ) : null}

              {onShareMessage || onShareConversation ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      size={"icon"}
                      variant={"outline"}
                      disabled={disableActions}
                      className="rounded-md transition hover:bg-[rgba(0,0,0,0.05)] disabled:opacity-50 border-0 size-7"
                    >
                      <Share2 size={14} className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    {onShareMessage ? (
                      <DropdownMenuItem
                        onClick={onShareMessage}
                        className="text-xs"
                      >
                        Share message
                      </DropdownMenuItem>
                    ) : null}
                    {onShareConversation ? (
                      <DropdownMenuItem
                        onClick={onShareConversation}
                        className="text-xs"
                      >
                        Share conversation
                      </DropdownMenuItem>
                    ) : null}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}

              {onRetry ? (
                <Button
                  type="button"
                  size={"icon"}
                  variant={"outline"}
                  onClick={onRetry}
                  disabled={disableActions}
                  className="rounded-md transition hover:bg-[rgba(0,0,0,0.05)] disabled:opacity-50 border-0 size-7"
                >
                  <RotateCcw size={11} className="size-4" />
                </Button>
              ) : null}
            </div>
          )}
        </div>
      </div>
    );
  },
);

ChatMessage.displayName = "ChatMessage";
