"use client";

import { useDeleteConversation, useFetchConversations } from "@/hooks/api";
import { $sidebarAtom } from "@/store";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@workspace/ui/components/alert-dialog";
import { Button } from "@workspace/ui/components/button";
import { cn } from "@workspace/ui/lib/utils";
import { useAtom } from "jotai";
import {
  Loader2,
  PanelRight,
  Pencil,
  Plus,
  SettingsIcon,
  Trash2,
  X,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { conversationTitle, groupConversations } from "./utils";

export function ConversationSidebar() {
  const router = useRouter();
  const pathname = useParams<{ conversationId?: string }>();
  const activeConversationId = pathname?.conversationId;

  const [sidebarAtom, setSidebarAtom] = useAtom($sidebarAtom);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: conversations, isLoading: loading } = useFetchConversations();
  const deleteConversation = useDeleteConversation({
    onSuccess: () => {
      toast.success("Conversation deleted", {});
    },
    onError: () => {
      toast.error("Failed to delete conversation", {});
    },
  });

  const handleSubmit = useCallback(
    async (conversationId: string) => {
      if (editValue.trim()) {
        try {
          const { updateConversationTitle } =
            await import("@/lib/frontclaw-api");
          await updateConversationTitle(conversationId, editValue.trim());
        } catch (error) {
          console.error("Failed to rename conversation:", error);
        }
      }
      setEditingId(null);
      setEditValue("");
    },
    [editValue],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent, conversationId: string) => {
      if (e.key === "Enter") {
        handleSubmit(conversationId);
      } else if (e.key === "Escape") {
        setEditingId(null);
        setEditValue("");
      }
    },
    [handleSubmit],
  );

  useEffect(() => {
    if (editingId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingId]);

  const handleBlur = useCallback(
    (conversationId: string) => {
      handleSubmit(conversationId);
    },
    [handleSubmit],
  );

  const toggleSidebar = () => {
    setSidebarAtom({ open: !sidebarAtom.open });
  };

  return (
    <>
      <aside
        className={cn(
          `absolute inset-y-0 left-0 z-40 w-[240px] max-w-[320px] border-r border-[var(--frontui-line)] transition lg:static lg:z-10 lg:w-[200px+24px] lg:max-w-none ${
            sidebarAtom.open
              ? "translate-x-0"
              : "-translate-x-[102%] lg:translate-x-0"
          }`,
          !sidebarAtom.open && "w-14",
          "overflow-y-auto",
        )}
      >
        <div className="sticky top-0 left-0 w-full pt-3 px-3 bg-amber-50/5 z-50 border-0 shadow-none backdrop-blur-3xl">
          <div
            className={cn(
              "mb-6 flex items-center justify-between gap-x-2 group",
              !sidebarAtom.open && "items-center justify-center gap-x-0",
            )}
          >
            <div
              className={cn(
                "flex items-center justify-center",
                !sidebarAtom.open && "group-hover:hidden",
              )}
            >
              <Logo iconOnly={!sidebarAtom.open} />
            </div>
            <Button
              onClick={toggleSidebar}
              variant={"outline"}
              size={"icon"}
              className={cn(
                "max-h-7 items-center justify-center flex",
                !sidebarAtom.open && "hidden group-hover:flex",
              )}
            >
              <PanelRight size={16} className="rotate-180" />
            </Button>
          </div>
          <div className="mb-4 flex items-center justify-between">
            {sidebarAtom.open ? (
              <Button
                type="button"
                onClick={() => {
                  router.push("/");
                }}
                className="flex-1 inline-flex items-center justify-center gap-1 rounded-lg border border-[var(--frontui-line)] bg-[var(--frontui-surface)] px-2.5 py-1.5 text-xs font-medium text-[var(--frontui-ink)] transition hover:bg-[var(--frontui-surface-2)]"
              >
                <Plus size={14} /> New chat
              </Button>
            ) : (
              <Button
                type="button"
                size={'icon'}
                onClick={() => {
                  router.push("/");
                }}
                className="flex-1 inline-flex items-center justify-center gap-1 rounded-lg border border-[var(--frontui-line)] bg-[var(--frontui-surface)] text-[var(--frontui-ink)] transition hover:bg-[var(--frontui-surface-2)]"
              >
                <Plus size={14} />
              </Button>
            )}
          </div>
        </div>

        {sidebarAtom.open ? (
          <div className="space-y-2 overflow-y-auto px-3 pt-6">
            {loading ? (
              <div className="flex items-center gap-2 rounded-xl border border-[var(--frontui-line)] bg-[var(--frontui-surface)] p-3 text-sm text-[var(--frontui-muted)]">
                <Loader2 className="animate-spin" size={16} /> Loading
                conversations...
              </div>
            ) : conversations?.length === 0 ? (
              <div className="rounded-xl border border-dashed border-[var(--frontui-line)] bg-[var(--frontui-surface)] p-4 text-sm text-[var(--frontui-muted)]">
                No conversations yet. Start your first message.
              </div>
            ) : (
              (() => {
                const grouped = groupConversations(conversations ?? []);
                const order: Array<"recent" | "yesterday" | "past"> = [
                  "recent",
                  "yesterday",
                  "past",
                ];
                return (
                  <>
                    {order.map((groupKey) => {
                      const items = grouped.get(groupKey) || [];
                      if (items.length === 0) return null;
                      return (
                        <div key={groupKey} className="mb-4">
                          <h3 className="mb-2 ml-3 text-xs font-semibold uppercase tracking-[0.19em] text-[var(--frontui-muted)]">
                            {groupKey === "recent"
                              ? "Recent"
                              : groupKey === "yesterday"
                                ? "Yesterday"
                                : "Past"}
                          </h3>
                          <div className="min-h-[80vh]">
                            {items.map((conversation) => {
                              const active =
                                conversation.id === activeConversationId;
                              const isEditing = editingId === conversation.id;

                              return (
                                <div
                                  key={conversation.id}
                                  className={cn(
                                    `group flex items-center relative message-enter w-full rounded-lg border border-transparent h-9 py-1 text-left transition`,
                                    active
                                      ? "border-[var(--frontui-accent)]/20 bg-[var(--frontui-accent-soft)]/20"
                                      : "hover:bg-[var(--frontui-surface-2)]",
                                  )}
                                >
                                  <Link
                                    href={`/c/${conversation.id}`}
                                    className={`w-full px-2 pl-3`}
                                  >
                                    {isEditing ? (
                                      <div className="relative">
                                        <input
                                          ref={inputRef}
                                          type="text"
                                          value={editValue}
                                          onChange={(e) =>
                                            setEditValue(e.target.value)
                                          }
                                          onBlur={() =>
                                            handleBlur(conversation.id)
                                          }
                                          onKeyDown={(e) =>
                                            handleKeyDown(e, conversation.id)
                                          }
                                          className="w-full rounded border border-[var(--frontui-line)] bg-[var(--frontui-surface)] px-2 py-1 text-sm text-[var(--frontui-ink)] focus:outline-none focus:ring-2 focus:ring-[var(--frontui-accent)]"
                                        />
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setEditingId(null);
                                            setEditValue("");
                                          }}
                                          className="absolute right-1 top-1/2 -translate-y-1/2 p-1 text-[var(--frontui-muted)] hover:text-[var(--frontui-ink)]"
                                        >
                                          <X size={14} />
                                        </button>
                                      </div>
                                    ) : (
                                      <div className="flex items-center justify-between gap-2">
                                        <p className="line-clamp-1 text-sm text-[var(--frontui-ink)]">
                                          {conversationTitle(conversation)}
                                        </p>
                                      </div>
                                    )}
                                  </Link>

                                  <div className="hidden items-center gap-1 shrink-0 group-hover:flex">
                                    <Button
                                      size={"icon"}
                                      variant="outline"
                                      className="rounded-full p-1 size-7"
                                      onClick={() => {
                                        setEditingId(conversation.id);
                                      }}
                                    >
                                      <Pencil size={10} />
                                    </Button>

                                    <AlertDialog>
                                      <AlertDialogTrigger asChild>
                                        <Button
                                          size={"icon"}
                                          variant="outline"
                                          className="rounded-full p-1 size-7"
                                        >
                                          <Trash2 size={10} />
                                        </Button>
                                      </AlertDialogTrigger>
                                      <AlertDialogContent className="">
                                        <AlertDialogHeader>
                                          <AlertDialogTitle>
                                            Confirmation
                                          </AlertDialogTitle>
                                          <AlertDialogDescription>
                                            Are you sure you want to delete
                                            this?
                                          </AlertDialogDescription>
                                        </AlertDialogHeader>

                                        <AlertDialogFooter>
                                          <AlertDialogCancel>
                                            Cancel
                                          </AlertDialogCancel>
                                          <AlertDialogAction
                                            onClick={async () => {
                                              await deleteConversation.mutateAsync(
                                                {
                                                  conversationId:
                                                    conversation.id,
                                                },
                                              );
                                            }}
                                          >
                                            Continue
                                          </AlertDialogAction>
                                        </AlertDialogFooter>
                                      </AlertDialogContent>
                                    </AlertDialog>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </>
                );
              })()
            )}
          </div>
        ) : <div className="h-[80vh]"></div>}

        <div className="sticky bottom-0 left-0 py-2 px-3 w-full bg-amber-50/5 backdrop-blur-3xl">
          <div className="w-full">
            <Button
              className="w-full flex-1 inline-flex items-center justify-center gap-1 rounded-lg border border-[var(--frontui-line)] bg-[var(--frontui-surface)] px-2.5 py-1.5 text-xs font-medium text-[var(--frontui-ink)] transition hover:bg-[var(--frontui-surface-2)]"
              onClick={() => {
                router.push("/settings");
              }}
              size={!sidebarAtom.open ? 'icon' : 'sm'}
            >
              <SettingsIcon size={13} />
              {sidebarAtom.open && <span>Settings</span>}
            </Button>
          </div>
        </div>
      </aside>
    </>
  );
}

const Logo = ({ iconOnly }: { iconOnly?: boolean }) => {
  return (
    <Link href={"/"}>
      <div className="flex items-center gap-2">
        <Image
          src={"/logo.png"}
          width={28}
          height={28}
          alt="Logo"
          className="size-7"
        />
        {!iconOnly && <p className="text-sm font-semibold">frontpanel</p>}
      </div>
    </Link>
  );
};
