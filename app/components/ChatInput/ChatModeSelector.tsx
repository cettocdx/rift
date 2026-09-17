"use client";

import { useGlobalState } from "@/app/contexts/GlobalState";
import { useAuth } from "@/app/hooks/useAuth";
import { toast } from "sonner";
import { navigateToAuth } from "@/app/hooks/useTauri";
import type { ChatMode } from "@/types/chat";
import { ChevronDown, Check } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export interface ChatModeSelectorProps {
  className?: string;
}

export function ChatModeSelector({ className }: ChatModeSelectorProps) {
  const { chatMode, setChatMode, chatPurpose, temporaryChatsEnabled } =
    useGlobalState();
  const { user } = useAuth();

  // In Build mode the two modes are framed as "Agent" (builds it) vs "Plan"
  // (thinks it through without executing — the ask path). Elsewhere it's the
  // usual Agent / Ask.
  const isBuild = chatPurpose === "app";
  const askLabel = isBuild ? "Plan" : "Ask";

  const handleAgentModeClick = () => {
    if (!user) {
      navigateToAuth("/signup", { preferSignInForReturningUser: true });
      return;
    }
    if (temporaryChatsEnabled) {
      toast.info("Agent mode requires chat history", {
        description: "Turn off temporary chat to use Agent mode.",
      });
      return;
    }
    setChatMode("agent");
  };

  const setMode = (mode: ChatMode) => {
    if (mode === "agent") handleAgentModeClick();
    else setChatMode("ask");
  };

  const selectedLabel =
    chatMode === "agent" ? (isBuild ? "Build" : "Agent") : askLabel;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-rift-composer-trigger
          aria-label={`Chat mode: ${selectedLabel}`}
          data-ui="chat-mode-trigger"
          className={`inline-flex h-11 shrink-0 items-center gap-1.5 rounded-[9px] px-2.5 text-ui-label text-foreground transition-colors hover:bg-muted md:h-7 ${className ?? ""}`}
        >
          {selectedLabel}
          <ChevronDown aria-hidden className="size-3" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        data-rift-composer-menu="mode"
        align="start"
        sideOffset={7}
        className="w-60 rounded-xl p-1.5"
      >
        {(["agent", "ask"] as const).map((mode) => (
          <DropdownMenuItem
            key={mode}
            onSelect={() => setMode(mode)}
            aria-label={
              mode === "agent" ? (isBuild ? "Build" : "Agent") : askLabel
            }
            className="min-h-11 items-center gap-3 rounded-lg px-2.5 py-2"
          >
            <span className="flex-1">
              <span className="rift-menu-label block">
                {mode === "agent" ? (isBuild ? "Build" : "Agent") : askLabel}
              </span>
              <span className="rift-menu-description block">
                {mode === "agent"
                  ? "Make changes and run tools"
                  : "Explore an idea before building"}
              </span>
            </span>
            {chatMode === mode ? (
              <Check aria-hidden className="size-3.5" />
            ) : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
