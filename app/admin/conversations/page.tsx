"use client";

import { useMemo, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { type FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn, fmtRelative, fmtDateTime, Pill, Search, Chat, X } from "../_lib";

type Row = NonNullable<
  FunctionReturnType<typeof api.admin.getAdminActivity>
>[number];

export default function ConversationsPage() {
  const activity = useQuery(api.admin.getAdminActivity);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Row | null>(null);
  const transcriptTriggerRef = useRef<HTMLButtonElement | null>(null);

  const rows = useMemo(() => {
    const list = activity ?? [];
    const query = q.trim().toLowerCase();
    if (!query) return list;
    return list.filter(
      (c) =>
        c.title.toLowerCase().includes(query) ||
        c.email.toLowerCase().includes(query) ||
        (c.name ?? "").toLowerCase().includes(query),
    );
  }, [activity, q]);

  const loading = activity === undefined;
  const closeTranscript = () => {
    setOpen(null);
    window.setTimeout(() => transcriptTriggerRef.current?.focus(), 0);
  };

  return (
    <div className="flex h-[calc(100dvh-3rem)] flex-col md:h-[100dvh]">
      <header className="flex items-center justify-between border-b border-neutral-800/80 px-4 py-4 sm:px-6 md:px-7">
        <div className="flex items-baseline gap-3">
          <h1 className="text-[15px] font-semibold text-neutral-100">
            Conversations
          </h1>
          <span className="text-[12px] text-neutral-500">
            {activity ? `${activity.length.toLocaleString()} total` : "—"}
          </span>
        </div>
      </header>

      <div className="px-4 pt-4 sm:px-6 md:px-7 md:pt-5">
        <label className="flex items-center gap-2.5 rounded-lg border border-neutral-800 bg-neutral-900/50 px-3.5 py-2.5 focus-within:border-neutral-700">
          <span className="sr-only">Search conversations</span>
          <Search aria-hidden="true" className="h-4 w-4 text-neutral-500" />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by title, user or email…"
            aria-controls="admin-conversations-table"
            className="w-full bg-transparent text-[13px] text-neutral-200 placeholder:text-neutral-600 focus:outline-none"
          />
        </label>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-4 pb-6 pt-4 sm:px-6 md:px-7 md:pb-8">
        <table
          id="admin-conversations-table"
          className="w-full min-w-[760px] border-separate border-spacing-0 text-[13px]"
        >
          <thead className="sticky top-0 z-10 bg-neutral-950">
            <tr className="text-left text-[11px] font-medium uppercase tracking-wide text-neutral-500">
              <Th>Title</Th>
              <Th>User</Th>
              <Th className="w-40">Model</Th>
              <Th className="w-28">Created</Th>
              <Th className="w-28">Updated</Th>
            </tr>
          </thead>
          <tbody>
            {loading &&
              Array.from({ length: 12 }).map((_, i) => (
                <tr key={i} className="border-b border-neutral-900">
                  <td colSpan={5} className="px-3 py-3.5">
                    <div className="h-4 w-full animate-pulse rounded bg-neutral-900 motion-reduce:animate-none" />
                  </td>
                </tr>
              ))}

            {!loading && rows.length === 0 && (
              <tr>
                <td
                  colSpan={5}
                  className="px-3 py-16 text-center text-[13px] text-neutral-600"
                >
                  No conversations match “{q}”.
                </td>
              </tr>
            )}

            {!loading &&
              rows.map((c) => (
                <tr
                  key={c.chatId}
                  className="group border-b border-neutral-900 transition-colors hover:bg-neutral-900/40"
                >
                  <Td className="max-w-[320px] truncate font-medium text-neutral-100">
                    <button
                      type="button"
                      aria-haspopup="dialog"
                      aria-controls="admin-conversation-transcript"
                      aria-expanded={open?.chatId === c.chatId}
                      aria-label={`Open transcript: ${c.title}`}
                      onClick={(event) => {
                        transcriptTriggerRef.current = event.currentTarget;
                        setOpen(c);
                      }}
                      className="inline-flex max-w-full items-center rounded-sm text-left transition-colors hover:text-emerald-300 focus-visible:outline-none"
                    >
                      <span className="mr-2 inline-block text-neutral-600 group-hover:text-emerald-400">
                        <Chat
                          aria-hidden="true"
                          className="inline h-3.5 w-3.5"
                        />
                      </span>
                      <span className="truncate">{c.title}</span>
                    </button>
                  </Td>
                  <Td className="text-neutral-400">
                    <div className="text-neutral-200">{c.name ?? "—"}</div>
                    <div className="max-w-[200px] truncate text-[11.5px] text-neutral-500">
                      {c.email}
                    </div>
                  </Td>
                  <Td>
                    {c.mode ? (
                      <span className="font-mono text-[11.5px] text-neutral-400">
                        {c.mode}
                      </span>
                    ) : (
                      <span className="text-neutral-600">—</span>
                    )}
                  </Td>
                  <Td className="text-neutral-500">
                    {fmtRelative(c.createdAt)}
                  </Td>
                  <Td className="text-neutral-400">
                    {fmtRelative(c.updatedAt)}
                  </Td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {open && <Transcript chat={open} onClose={closeTranscript} />}
    </div>
  );
}

function Transcript({ chat, onClose }: { chat: Row; onClose: () => void }) {
  const messages = useQuery(api.admin.getAdminChatMessages, {
    chatId: chat.chatId,
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        id="admin-conversation-transcript"
        aria-modal="true"
        showCloseButton={false}
        className="!left-auto !right-0 !top-0 flex h-[100dvh] w-[600px] max-w-[calc(100vw-1rem)] !translate-x-0 !translate-y-0 flex-col gap-0 rounded-none border-y-0 border-r-0 border-l border-neutral-800 bg-neutral-950 p-0 text-neutral-200 shadow-2xl sm:max-w-[600px]"
      >
        <div className="flex items-start justify-between border-b border-neutral-800/80 px-5 py-4">
          <div className="min-w-0">
            <DialogTitle className="truncate text-[14px] font-semibold text-neutral-100">
              {chat.title}
            </DialogTitle>
            <DialogDescription className="sr-only">
              Conversation transcript for {chat.email}.
            </DialogDescription>
            <div className="mt-0.5 flex items-center gap-2 text-[11.5px] text-neutral-500">
              <span className="truncate">{chat.email}</span>
              {chat.mode && (
                <>
                  <span className="text-neutral-700">·</span>
                  <span className="font-mono">{chat.mode}</span>
                </>
              )}
            </div>
          </div>
          <DialogClose asChild>
            <button
              type="button"
              aria-label="Close conversation transcript"
              className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-neutral-500 transition-colors hover:bg-neutral-800 hover:text-neutral-200 focus-visible:outline-none"
            >
              <X aria-hidden="true" className="h-4 w-4" />
            </button>
          </DialogClose>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-auto px-5 py-5">
          {messages === undefined && (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div
                  key={i}
                  className="h-16 animate-pulse rounded-lg bg-neutral-900 motion-reduce:animate-none"
                />
              ))}
            </div>
          )}
          {messages && messages.length === 0 && (
            <div className="py-16 text-center text-[13px] text-neutral-600">
              No messages in this conversation.
            </div>
          )}
          {messages?.map((m) => {
            const isUser = m.role === "user";
            return (
              <div key={m.id} className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <Pill tone={isUser ? "neutral" : "emerald"}>
                    {isUser ? "User" : "RIFT"}
                  </Pill>
                  <span className="text-[10.5px] text-neutral-600">
                    {fmtDateTime(m.createdAt)}
                  </span>
                </div>
                <div
                  className={cn(
                    "whitespace-pre-wrap break-words rounded-lg border px-3.5 py-2.5 text-[12.5px] leading-relaxed",
                    isUser
                      ? "border-neutral-800 bg-neutral-900/60 text-neutral-200"
                      : "border-neutral-800/60 bg-neutral-900/30 text-neutral-300",
                  )}
                >
                  {m.text || (
                    <span className="text-neutral-600">
                      (no text, tool parts only)
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Th({
  children,
  className,
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      scope="col"
      className={cn(
        "border-b border-neutral-800 px-3 pb-2.5 pt-1 font-medium",
        className,
      )}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  className,
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  return <td className={cn("px-3 py-3", className)}>{children}</td>;
}
