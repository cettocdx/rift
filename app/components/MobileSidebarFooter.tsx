"use client";

import Link from "next/link";
import { Settings, SquarePen } from "lucide-react";
import { usePathname } from "next/navigation";
import { useGlobalState } from "@/app/contexts/GlobalState";
import {
  isPurposeChatActive,
  useChatNavigation,
} from "@/app/hooks/useChatNavigation";
import { useSettingsNavigation } from "./settings/useSettingsNavigation";

/** Mobile navigation has two persistent actions; account and usage live in Settings. */
export function MobileSidebarFooter({
  onNavigate,
}: {
  onNavigate: () => void;
}) {
  const { hrefFor } = useSettingsNavigation();
  const { goPurpose } = useChatNavigation();
  const pathname = usePathname();
  const { chatPurpose, initializeNewChat, setTemporaryChatsEnabled } =
    useGlobalState();

  const newChat = () => {
    if (
      chatPurpose === "app" &&
      isPurposeChatActive("app", pathname, chatPurpose)
    ) {
      initializeNewChat("app");
    }
    setTemporaryChatsEnabled(false);
    onNavigate();
    goPurpose("app");
  };

  return (
    <div
      data-testid="mobile-sidebar-footer"
      className="flex shrink-0 items-center justify-between gap-4 px-5 pt-3 pb-[max(16px,env(safe-area-inset-bottom))]"
    >
      <button
        type="button"
        onClick={newChat}
        className="inline-flex min-h-12 items-center gap-2.5 rounded-full bg-foreground px-5 text-[17px] font-semibold text-background shadow-sm transition-transform active:scale-[0.97] motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
      >
        <SquarePen aria-hidden className="size-5" />
        New chat
      </button>
      <Link
        href={hrefFor(null)}
        onClick={onNavigate}
        aria-label="Settings"
        className="flex size-12 shrink-0 items-center justify-center rounded-full border border-border bg-muted/50 text-foreground transition-transform active:scale-[0.94] motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
      >
        <Settings aria-hidden className="size-6" strokeWidth={1.8} />
      </Link>
    </div>
  );
}
