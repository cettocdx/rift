"use client";

import { Button } from "@/components/ui/button";
import { DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ChevronDown } from "lucide-react";
import type { ChatMode } from "@/types/chat";

const MODE_VARIANT_CLASSES: Record<ChatMode, string> = {
  ask: "bg-transparent text-muted-foreground hover:bg-accent hover:text-foreground",
  agent: "bg-accent text-foreground hover:bg-accent/80",
};

const baseClasses =
  "h-7 shrink-0 cursor-pointer rounded-[7px] px-2 text-ui-caption font-medium motion-reduce:transition-none";

export interface ModeSelectorTriggerProps {
  chatMode: ChatMode;
}

export function ModeSelectorTrigger({ chatMode }: ModeSelectorTriggerProps) {
  return (
    <DropdownMenuTrigger asChild>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        data-testid="mode-selector"
        aria-label={`${chatMode === "agent" ? "Agent" : "Plan"} mode`}
        className={`${baseClasses} ${MODE_VARIANT_CLASSES[chatMode]}`}
      >
        {chatMode === "agent" ? (
          <span className="hidden md:inline">Agent</span>
        ) : (
          <span className="hidden md:inline">Plan</span>
        )}
        <ChevronDown
          aria-hidden="true"
          className="ml-1 size-3 text-muted-foreground"
          strokeWidth={1.8}
        />
      </Button>
    </DropdownMenuTrigger>
  );
}
