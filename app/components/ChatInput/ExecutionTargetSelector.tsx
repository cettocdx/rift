"use client";

import Link from "next/link";
import { Check, ChevronDown, Cloud, Laptop } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { SandboxPreference } from "@/types/chat";

interface ExecutionTargetSelectorProps {
  value: SandboxPreference;
  localTarget: SandboxPreference | null;
  hasLocalTarget: boolean;
  selectedLocalAvailable?: boolean;
  localTargets?: Array<{ value: SandboxPreference; label: string }>;
  onChange: (value: SandboxPreference) => void;
}

export function ExecutionTargetSelector({
  value,
  localTarget,
  hasLocalTarget,
  selectedLocalAvailable,
  localTargets,
  onChange,
}: ExecutionTargetSelectorProps) {
  const isLocal = value !== "e2b";
  const Icon = isLocal ? Laptop : Cloud;
  const localAvailable = hasLocalTarget && localTarget !== null;
  const selectedUnavailable = isLocal && selectedLocalAvailable === false;
  const targets = localTargets?.length
    ? localTargets
    : localAvailable && localTarget
      ? [{ value: localTarget, label: "Local" }]
      : [];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-rift-composer-trigger
          aria-label={`Execution target: ${isLocal ? "Local" : "Cloud"}${selectedUnavailable ? ", disconnected" : ""}`}
          className="inline-flex h-7 shrink-0 cursor-pointer items-center gap-1 rounded-[7px] px-1.5 text-ui-caption font-medium text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground active:bg-accent motion-reduce:transition-none"
        >
          <Icon aria-hidden="true" className="size-3.5" strokeWidth={1.7} />
          <span className="inline">{isLocal ? "Local" : "Cloud"}</span>
          {selectedUnavailable ? (
            <span className="text-ui-caption text-muted-foreground">
              Disconnected
            </span>
          ) : null}
          <ChevronDown
            aria-hidden="true"
            className="size-3 text-muted-foreground"
            strokeWidth={1.8}
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        data-rift-composer-menu="execution"
        align="start"
        side="top"
        sideOffset={6}
        collisionPadding={8}
        className="w-56 rounded-[10px] border-border-strong bg-popover p-1 text-popover-foreground shadow-xl shadow-black/10 dark:shadow-black/40"
      >
        <DropdownMenuItem
          onSelect={() => onChange("e2b")}
          aria-current={!isLocal ? "true" : undefined}
          className="flex cursor-pointer items-center gap-2 rounded-[6px] px-2 py-1.5 text-ui-label focus:bg-accent focus:text-accent-foreground"
        >
          <Cloud aria-hidden="true" className="size-3.5" strokeWidth={1.7} />
          <span className="rift-menu-label min-w-0 flex-1">Cloud</span>
          <Check
            aria-hidden="true"
            className={`size-3.5 ${isLocal ? "text-transparent" : "text-foreground"}`}
            strokeWidth={1.8}
          />
        </DropdownMenuItem>
        {targets.map((target) => (
          <DropdownMenuItem
            key={target.value}
            onSelect={() => onChange(target.value)}
            aria-current={value === target.value ? "true" : undefined}
            className="flex cursor-pointer items-center gap-2 rounded-[6px] px-2 py-1.5 text-ui-label focus:bg-accent focus:text-accent-foreground"
          >
            <Laptop
              aria-hidden
              className="size-3.5 shrink-0"
              strokeWidth={1.7}
            />
            <span className="rift-menu-label min-w-0 flex-1 truncate">
              {target.label}
            </span>
            <Check
              aria-hidden
              className={`size-3.5 shrink-0 ${value === target.value ? "text-foreground" : "text-transparent"}`}
              strokeWidth={1.8}
            />
          </DropdownMenuItem>
        ))}
        {!targets.length || selectedUnavailable ? (
          <>
            <DropdownMenuSeparator />
            <p className="rift-menu-description px-2 py-1.5">
              {selectedUnavailable
                ? "Reconnect the selected computer to continue there."
                : "Connect a computer in Settings to work locally."}
            </p>
          </>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          asChild
          className="cursor-pointer rounded-[6px] px-2 py-1.5 text-ui-label text-muted-foreground focus:bg-accent focus:text-accent-foreground"
        >
          <Link className="rift-menu-label" href="/settings/workbench">
            {targets.length ? "Manage computers…" : "Connect a computer…"}
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
