"use client";
import { useRef } from "react";
import {
  Check,
  ChevronDown,
  ListChecks,
  FilePenLine,
  ShieldCheck,
} from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useApprovalMode } from "@/app/hooks/useApprovalMode";
import { APPROVAL_LABELS, type ApprovalMode } from "@/lib/ai/approval/policy";
const choices = [
  {
    id: "ask",
    icon: ListChecks,
    description: "Confirm edits, commands and connected actions.",
  },
  {
    id: "auto",
    icon: FilePenLine,
    description: "Allow supported file edits; confirm other actions.",
  },
  {
    id: "full",
    icon: ShieldCheck,
    description: "Use available tools without approval prompts.",
  },
] as const;
export function ApprovalModeSelector() {
  const [mode, setMode] = useApprovalMode();
  const menu = useRef<HTMLDivElement>(null);
  const focusOption = (option?: HTMLButtonElement | null) => {
    if (!option || !menu.current) return;
    option.focus({ preventScroll: true });
    const viewport = menu.current.getBoundingClientRect();
    const bounds = option.getBoundingClientRect();
    if (bounds.top < viewport.top + 4)
      menu.current.scrollTop += bounds.top - viewport.top - 4;
    else if (bounds.bottom > viewport.bottom - 4)
      menu.current.scrollTop += bounds.bottom - viewport.bottom + 4;
  };
  const Icon = choices.find((c) => c.id === mode)!.icon;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-rift-composer-trigger
          aria-label={`Permissions: ${APPROVAL_LABELS[mode]}`}
          title={`Permissions: ${APPROVAL_LABELS[mode]}`}
          className="inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2 text-[12px] text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground data-[state=open]:bg-muted data-[state=open]:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
        >
          <Icon aria-hidden className="size-3.5 shrink-0" strokeWidth={1.7} />
          <span data-ui="approval-mode-label" className="hidden sm:inline">
            {APPROVAL_LABELS[mode]}
          </span>
          <ChevronDown
            aria-hidden
            className="hidden size-3 shrink-0 opacity-60 sm:block"
          />
        </button>
      </PopoverTrigger>
      <PopoverContent
        ref={menu}
        data-rift-composer-menu="approval"
        side="top"
        align="start"
        collisionPadding={8}
        className="max-h-[var(--radix-popover-content-available-height)] w-[min(380px,calc(100vw-24px))] overflow-y-auto overscroll-contain p-1.5"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          focusOption(
            menu.current?.querySelector<HTMLButtonElement>(
              '[role="radio"][aria-checked="true"]',
            ),
          );
        }}
      >
        <p className="rift-menu-heading px-2.5 py-2">Permissions</p>
        <div role="radiogroup" aria-label="Action permissions">
          {choices.map(({ id, icon: ChoiceIcon, description }, index) => (
            <button
              key={id}
              role="radio"
              aria-checked={mode === id}
              tabIndex={mode === id ? 0 : -1}
              type="button"
              onKeyDown={(event) => {
                const delta = {
                  ArrowDown: 1,
                  ArrowRight: 1,
                  ArrowUp: -1,
                  ArrowLeft: -1,
                }[event.key];
                const next =
                  event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? choices.length - 1
                      : delta === undefined
                        ? undefined
                        : (index + delta + choices.length) % choices.length;
                if (next === undefined) return;
                event.preventDefault();
                setMode(choices[next].id);
                focusOption(
                  menu.current?.querySelectorAll<HTMLButtonElement>(
                    '[role="radio"]',
                  )[next],
                );
              }}
              onClick={() => setMode(id as ApprovalMode)}
              className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-foreground transition-colors duration-150 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring motion-reduce:transition-none ${mode === id ? "bg-muted/70" : ""}`}
            >
              <ChoiceIcon
                aria-hidden
                className="size-4 shrink-0 text-muted-foreground"
                strokeWidth={1.7}
              />
              <span className="flex-1">
                <span className="rift-menu-label block">
                  {APPROVAL_LABELS[id]}
                </span>
                <span className="rift-menu-description mt-0.5 block">
                  {description}
                </span>
              </span>
              {mode === id && <Check aria-hidden className="size-4" />}
            </button>
          ))}
        </div>
        <p className="rift-menu-description border-t px-2.5 pb-1 pt-2">
          For your next message. Account and workspace limits remain in place.
        </p>
      </PopoverContent>
    </Popover>
  );
}
