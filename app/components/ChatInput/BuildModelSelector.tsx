"use client";

import { BuildParametersSelector } from "./BuildParametersSelector";
import { useEffect, useRef, useState } from "react";
import { focusSelectedModelOption } from "./model-menu-focus";
import { Check, ChevronDown } from "lucide-react";
import { BuildModelLogo } from "@/app/components/ModelSelector/ModelLogo";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  BUILD_MODELS,
  formatBuildModelContext,
  getEffectiveBuildModel,
  type ReasoningEffort,
} from "@/types/chat";
import type { SelectedModel } from "@/types/chat";

interface BuildModelSelectorProps {
  value: SelectedModel;
  onChange: (model: SelectedModel) => void;
  /** Keep the empty-state picker below its trigger, matching Cursor. */
  openDownward?: boolean;
  reasoningEffort?: ReasoningEffort;
  onReasoningChange?: (effort: ReasoningEffort) => void;
}

/**
 * Model picker shown in the composer when Build mode (purpose="app") is active.
 * Lets the user pick a curated current frontier codegen model. The selection
 * is stored in `selectedModel` and
 * mapped to an OpenRouter model server-side (see selectModel / providers.ts).
 */

export function BuildModelSelector({
  value,
  onChange,
  openDownward = false,
  reasoningEffort,
  onReasoningChange,
}: BuildModelSelectorProps) {
  // Highlight the active option; anything that isn't a build-* id (e.g. the
  // initial "auto") resolves to the default so the default model reads as
  // selected.
  const active = getEffectiveBuildModel(value);
  const menuRef = useRef<HTMLDivElement>(null);
  const [modelOpen, setModelOpen] = useState(false);
  useEffect(() => {
    if (!modelOpen) return;
    const frame = requestAnimationFrame(() => {
      focusSelectedModelOption(menuRef.current);
    });
    // Closing the popup must cancel pending focus, not steal it back later.
    return () => cancelAnimationFrame(frame);
  }, [modelOpen]);

  if (reasoningEffort && onReasoningChange)
    return (
      <BuildParametersSelector
        value={value}
        onChange={onChange}
        reasoningEffort={reasoningEffort}
        onReasoningChange={onReasoningChange}
        openDownward={openDownward}
      />
    );

  return (
    <>
      <DropdownMenu open={modelOpen} onOpenChange={setModelOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            data-rift-composer-trigger
            data-ui="model-selector-trigger"
            data-open-direction={openDownward ? "down" : "up"}
            aria-label={`Build model: ${active.model}`}
            title={`${active.provider} ${active.family}: ${active.model}. ${active.desc}. ${formatBuildModelContext(active.contextTokens)}. ${active.capabilities.join(", ")}.`}
            className="inline-flex h-11 min-w-11 max-w-[15rem] cursor-pointer items-center justify-center gap-1 rounded-[8px] px-1.5 text-ui-caption font-medium text-[var(--cursor-text-secondary)] outline-none transition-colors hover:bg-muted/70 hover:text-foreground active:bg-muted motion-reduce:transition-none md:h-7 md:min-w-0 md:justify-start md:rounded-[7px] sm:max-w-[17rem]"
          >
            <BuildModelLogo family={active.family} />
            <span
              data-ui="model-selector-label"
              className="hidden min-w-0 truncate sm:inline"
            >
              {active.model}
            </span>
            <ChevronDown
              aria-hidden="true"
              className="size-3 shrink-0 text-muted-foreground"
              strokeWidth={1.8}
            />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          data-rift-composer-menu="model"
          ref={menuRef}
          data-ui="model-selector-menu"
          data-open-direction={openDownward ? "down" : "up"}
          align="start"
          side={openDownward ? "bottom" : "top"}
          avoidCollisions
          sideOffset={6}
          collisionPadding={8}
          style={{
            maxHeight:
              "min(520px, var(--radix-dropdown-menu-content-available-height, 70dvh))",
          }}
          className="w-[280px] max-w-[calc(100vw-16px)] scroll-py-1 overflow-x-hidden overflow-y-auto overscroll-contain rounded-[10px] border-border-strong bg-popover p-1 text-popover-foreground shadow-xl shadow-black/10 motion-reduce:animate-none dark:shadow-black/40"
        >
          <div className="rift-menu-description flex justify-between px-2 py-1.5">
            <span>Context window</span>
            <span>{formatBuildModelContext(active.contextTokens)}</span>
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="rift-menu-heading px-2 py-1.5">
            Models
          </DropdownMenuLabel>
          {BUILD_MODELS.map((m) => {
            const isActive = m.id === active.id;
            const context = formatBuildModelContext(m.contextTokens);
            return (
              <DropdownMenuItem
                key={m.id}
                data-selected={isActive ? "true" : "false"}
                onSelect={() => onChange(m.id)}
                aria-current={isActive ? "true" : undefined}
                aria-label={`${m.model}, ${m.provider} ${m.family}, ${m.label}, ${context}, ${m.capabilities.join(", ")}`}
                title={`${m.desc}. ${m.capabilities.join(", ")}.`}
                className="flex min-h-11 cursor-pointer items-start gap-2 rounded-[6px] px-2 py-1.5 text-popover-foreground transition-colors focus:bg-muted focus:text-foreground motion-reduce:transition-none md:min-h-0"
              >
                <BuildModelLogo family={m.family} />
                <span className="min-w-0 flex-1 leading-tight">
                  <span className="flex min-w-0 items-baseline gap-2">
                    <span
                      data-ui="model-selector-model-name"
                      className="rift-menu-label min-w-0 flex-1 truncate text-foreground"
                    >
                      {m.model}
                    </span>
                    <span
                      data-ui="model-selector-context"
                      className="rift-menu-description shrink-0 tabular-nums text-muted-foreground"
                    >
                      {context}
                    </span>
                  </span>
                </span>
                <Check
                  aria-hidden="true"
                  className={`mt-0.5 size-3.5 shrink-0 ${
                    isActive ? "text-foreground" : "text-transparent"
                  }`}
                  strokeWidth={1.8}
                />
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
