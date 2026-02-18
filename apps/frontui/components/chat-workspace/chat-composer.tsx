"use client";

import { cn } from "@workspace/ui/lib/utils";
import { Loader2, SendHorizontal } from "lucide-react";
import { useState } from "react";
import TextareaAutosize from "react-textarea-autosize";

type ChatComposerProps = {
  defaultValue: string;
  onSend: (val: string) => void;
  sending: boolean;
  errorText: string | null;
  placeholder?: string;
};

export function ChatComposer({
  defaultValue,
  onSend,
  sending,
  errorText,
  placeholder = "Ask anything, tell what to do...",
}: ChatComposerProps) {
  const [composerValue, setComposerValue] = useState("");

  const onKeyDown: React.KeyboardEventHandler<HTMLTextAreaElement> = (
    event,
  ) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      onSend(composerValue);
    }
  };

  return (
    <div className="absolute bottom-4 left-2/4 w-full max-w-3xl">
      <div className="mx-auto max-w-3xl">
        {errorText ? (
          <p className="absolute left-2/4 bottom-20 -translate-x-2/4 mb-2 rounded-lg border border-[#e8c7bd] bg-[#fff2ed] px-3 py-2 text-sm text-[#8c3e21]">
            {errorText}
          </p>
        ) : null}

        <div
          className={cn(
            "w-full -translate-x-1/2 rounded-2xl border border-[var(--frontui-line)] bg-[var(--frontui-surface)] px-3 py-2 shadow-sm transition focus-within:border-[var(--frontui-accent)] focus-within:shadow-[0_0_0_1px_var(--frontui-accent)]",
          )}
        >
          <div className="flex items-end gap-2">
            <TextareaAutosize
              defaultValue={defaultValue}
              value={composerValue}
              onChange={(e) => setComposerValue(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={placeholder}
              minRows={1}
              maxRows={6}
              className="
        w-full resize-none bg-transparent
        px-2 py-2 text-sm text-[var(--frontui-ink)]
        outline-none
        placeholder:text-[var(--frontui-muted)]
      "
            />

            <button
              type="button"
              disabled={sending || composerValue.trim().length === 0}
              onClick={() => onSend(composerValue)}
              aria-label="Send message"
              className="
        inline-flex h-9 w-9 shrink-0 items-center justify-center
        rounded-full
        bg-[var(--frontui-accent)]
        text-[var(--primary-foreground)]
        transition
        hover:brightness-110
        disabled:bg-[var(--frontui-muted)]
        disabled:opacity-60
        disabled:hover:brightness-100
      "
            >
              {sending ? (
                <Loader2 className="animate-spin" size={16} />
              ) : (
                <SendHorizontal size={16} />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
