"use client";

import { type LucideIcon, Lock } from "lucide-react";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";

export interface ModeOptionItemProps {
  icon: LucideIcon;
  title: string;
  description: string;
  onClick: () => void;
  "data-testid"?: string;
  showLock?: boolean;
  showProBadge?: boolean;
}

export function ModeOptionItem({
  icon: Icon,
  title,
  description,
  onClick,
  "data-testid": testId,
  showLock = false,
  showProBadge = false,
}: ModeOptionItemProps) {
  return (
    <DropdownMenuItem
      onSelect={onClick}
      className="group flex cursor-pointer items-center gap-2 rounded-[6px] px-2 py-1.5 text-popover-foreground focus:bg-accent focus:text-accent-foreground"
      data-testid={testId}
    >
      <Icon
        aria-hidden="true"
        className="size-3.5 shrink-0 text-muted-foreground"
        strokeWidth={1.7}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2">
          <span className="text-ui-label font-medium">{title}</span>
          {showLock && (
            <Lock
              aria-hidden="true"
              className="size-3 text-muted-foreground"
              strokeWidth={1.7}
            />
          )}
          {showProBadge && (
            <span className="rounded-[4px] border border-border bg-muted px-1 text-[9px] text-muted-foreground">
              PRO
            </span>
          )}
        </div>
        <span className="truncate text-ui-caption text-muted-foreground">
          {description}
        </span>
      </div>
    </DropdownMenuItem>
  );
}
