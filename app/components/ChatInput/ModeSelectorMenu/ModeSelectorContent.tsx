"use client";

import { DropdownMenuContent } from "@/components/ui/dropdown-menu";
import { Bot, ListTodo } from "lucide-react";
import type { ChatMode } from "@/types/chat";
import { ModeOptionItem } from "./ModeOptionItem";

export interface ModeSelectorContentProps {
  setChatMode: (mode: ChatMode) => void;
  onAgentModeClick: () => void;
  temporaryChatsEnabled: boolean;
}

export function ModeSelectorContent({
  setChatMode,
  onAgentModeClick,
  temporaryChatsEnabled,
}: ModeSelectorContentProps) {
  return (
    <DropdownMenuContent
      align="start"
      sideOffset={6}
      collisionPadding={8}
      className="w-60 rounded-[10px] border-border-strong bg-popover p-1 text-popover-foreground shadow-xl shadow-black/10 dark:shadow-black/40"
    >
      <ModeOptionItem
        icon={Bot}
        title="Agent"
        description="Build and make changes"
        onClick={onAgentModeClick}
        data-testid="mode-agent"
        showLock={temporaryChatsEnabled}
      />
      <ModeOptionItem
        icon={ListTodo}
        title="Plan"
        description="Think through changes first"
        onClick={() => setChatMode("ask")}
        data-testid="mode-ask"
      />
    </DropdownMenuContent>
  );
}
