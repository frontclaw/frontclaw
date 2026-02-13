"use client";

import { MessageSquare } from "lucide-react";

export function ChatEmptyState() {
  return (
    <div className="card-elevated mx-auto max-w-2xl rounded-2xl p-7 text-center">
      <MessageSquare
        className="mx-auto mb-3 text-[var(--frontui-accent)]"
        size={28}
      />
      <h4 className="text-lg font-semibold text-[var(--frontui-ink)]">
        Ask anything
      </h4>
      <p className="mt-2 text-sm text-[var(--frontui-muted)]">
        This workspace streams responses in real time and keeps your
        conversations organized in the sidebar.
      </p>
    </div>
  );
}
