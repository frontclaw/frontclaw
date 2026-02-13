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
import type { UIMessage } from "./types";
import React from "react";

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
    const { role, content, pending, error } = message;

    const containerClass =
      role === "user"
        ? "ml-6 text-[var(--primary)]"
        : error
          ? "mr-6 border-[var(--frontui-line)] bg-[var(--frontui-surface)] text-[var(--frontui-ink)]"
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
              `message-enter rounded-2xl border bg-white p-4 py-1 ${containerClass}`,
              role === "assistant" && "bg-transparent border-0 py-4",
            )}
          >
            <div className="text-[13px] leading-7">
              {content ? (
                <MessageMarkdown content={content} />
              ) : pending && !error ? (
                <span>Thinking...</span>
              ) : null}
            </div>

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
                  className="rounded-md transition hover:bg-[rgba(0,0,0,0.05)] disabled:opacity-50 border-0"
                >
                  <Copy size={14} />
                </Button>
              ) : null}

              {onThumbUp ? (
                <Button
                  type="button"
                  size={"icon"}
                  variant={"outline"}
                  onClick={onThumbUp}
                  disabled={disableActions}
                  className="rounded-md transition hover:bg-[rgba(0,0,0,0.05)] disabled:opacity-50 border-0"
                >
                  <ThumbsUp size={14} />
                </Button>
              ) : null}

              {onThumbDown ? (
                <Button
                  type="button"
                  size={"icon"}
                  variant={"outline"}
                  onClick={onThumbDown}
                  disabled={disableActions}
                  className="rounded-md transition hover:bg-[rgba(0,0,0,0.05)] disabled:opacity-50 border-0"
                >
                  <ThumbsDown size={14} />
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
                      className="rounded-md transition hover:bg-[rgba(0,0,0,0.05)] disabled:opacity-50 border-0"
                    >
                      <Share2 size={14} />
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
                  className="rounded-md transition hover:bg-[rgba(0,0,0,0.05)] disabled:opacity-50 border-0"
                >
                  <RotateCcw size={11} />
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
