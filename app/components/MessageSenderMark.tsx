"use client";

import { useAuth } from "@/app/hooks/useAuth";
import { RiftPixelMark } from "@/components/icons/rift-pixel-mark";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

function userInitials(name: string | null, email: string): string {
  if (name) {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
    }
    if (parts[0]) return parts[0].slice(0, 2).toUpperCase();
  }
  if (email) return email.slice(0, 2).toUpperCase();
  return "U";
}

export function MessageSenderMark({ role }: { role: "user" | "assistant" }) {
  const { user } = useAuth();

  if (role === "assistant") {
    return (
      <div
        data-ui="message-sender-mark"
        data-role="assistant"
        className="mt-0.5 flex w-7 shrink-0 flex-col items-center gap-1"
        aria-hidden
      >
        <RiftPixelMark size={26} className="shrink-0" />
        <span className="select-none font-sans text-[9px] font-medium leading-none tracking-[-0.04em] text-[var(--cursor-text-secondary)]">
          RIFT
        </span>
      </div>
    );
  }

  const initials = userInitials(user?.name ?? null, user?.email ?? "");
  const label =
    user?.firstName?.trim() || user?.name?.trim()?.split(/\s+/)[0] || "You";

  return (
    <div
      data-ui="message-sender-mark"
      data-role="user"
      className="mt-0.5 flex w-7 shrink-0 flex-col items-center gap-1"
      aria-hidden
    >
      <Avatar className="size-[22px] rounded-[6px]">
        {user?.profilePictureUrl ? (
          <AvatarImage src={user.profilePictureUrl} alt="" />
        ) : null}
        <AvatarFallback className="rounded-[6px] bg-muted text-[9px] font-semibold text-foreground">
          {initials}
        </AvatarFallback>
      </Avatar>
      <span className="max-w-[52px] truncate text-[10px] font-medium leading-none text-[var(--cursor-text-secondary)]">
        {label}
      </span>
    </div>
  );
}
