"use client";

import { useRef } from "react";
import { Check, ChevronDown, Clapperboard, ImageIcon } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  DEFAULT_IMAGE_MODEL,
  IMAGE_MODELS,
  MEDIA_MODELS,
  VIDEO_MODELS,
} from "@/types/chat";
import type { SelectedModel } from "@/types/chat";
import { MediaModelLogo } from "@/app/components/ModelSelector/ModelLogo";

interface ImageModelSelectorProps {
  value: SelectedModel;
  onChange: (model: SelectedModel) => void;
}

type MediaOption = (typeof MEDIA_MODELS)[number];

function MediaModelItem({
  model,
  activeId,
  onChange,
}: {
  model: MediaOption;
  activeId: SelectedModel;
  onChange: (model: SelectedModel) => void;
}) {
  const active = model.id === activeId;
  return (
    <DropdownMenuItem
      onSelect={() => onChange(model.id)}
      aria-current={active ? "true" : undefined}
      data-selected={active ? "true" : "false"}
      className="group flex min-h-11 cursor-pointer items-center gap-2 rounded-[6px] px-2 py-1.5 text-popover-foreground transition-colors focus:bg-accent focus:text-accent-foreground motion-reduce:transition-none md:min-h-10"
    >
      <MediaModelLogo model={model.id} />
      <span className="min-w-0 flex-1 leading-tight">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-ui-label font-medium text-foreground">
            {model.name}
          </span>
          <span className="rounded-[4px] border border-border bg-muted px-1 py-px text-[9.5px] text-muted-foreground">
            {model.badge}
          </span>
        </span>
        <span className="mt-1 block truncate text-ui-caption text-muted-foreground">
          {model.desc}
        </span>
      </span>
      <Check
        aria-hidden="true"
        className={`size-3.5 shrink-0 ${active ? "text-foreground" : "text-transparent"}`}
        strokeWidth={1.8}
      />
    </DropdownMenuItem>
  );
}

/** Unified Media Studio picker for current image and video generation models. */
export function ImageModelSelector({
  value,
  onChange,
}: ImageModelSelectorProps) {
  const active =
    MEDIA_MODELS.find((model) => model.id === value) ??
    MEDIA_MODELS.find((model) => model.id === DEFAULT_IMAGE_MODEL)!;
  const menuRef = useRef<HTMLDivElement>(null);

  const focusSelectedModel = (isOpen: boolean) => {
    if (!isOpen) return;

    requestAnimationFrame(() => {
      const selected = menuRef.current?.querySelector<HTMLElement>(
        '[data-selected="true"]',
      );
      selected?.focus({ preventScroll: true });
      selected?.scrollIntoView?.({ block: "nearest" });
    });
  };

  return (
    <DropdownMenu onOpenChange={focusSelectedModel}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-ui="model-selector-trigger"
          aria-label={`Media model: ${active.name}`}
          title={`${active.name}: ${active.desc}`}
          className="inline-flex h-11 min-w-11 max-w-[12rem] cursor-pointer items-center justify-center gap-1 rounded-[8px] px-1.5 text-ui-caption font-medium text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground active:bg-accent motion-reduce:transition-none md:h-7 md:min-w-0 md:justify-start md:rounded-[7px]"
        >
          <MediaModelLogo model={active.id} />
          <span className="hidden min-w-0 truncate sm:inline">
            {active.name}
          </span>
          <ChevronDown
            className="size-3 shrink-0 text-muted-foreground"
            aria-hidden="true"
            strokeWidth={1.8}
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        ref={menuRef}
        data-ui="model-selector-menu"
        align="start"
        side="top"
        sideOffset={6}
        collisionPadding={8}
        style={{
          maxHeight:
            "min(520px, var(--radix-dropdown-menu-content-available-height, 70dvh))",
        }}
        className="w-[280px] max-w-[calc(100vw-16px)] scroll-py-1 overflow-x-hidden overflow-y-auto overscroll-contain rounded-[10px] border-border-strong bg-popover p-1 text-popover-foreground shadow-xl shadow-black/10 motion-reduce:animate-none dark:shadow-black/40"
      >
        <DropdownMenuLabel className="flex items-center gap-2 px-2 py-1.5 text-ui-caption font-medium text-muted-foreground">
          <ImageIcon
            className="size-3.5"
            aria-hidden="true"
            strokeWidth={1.7}
          />
          Image models
        </DropdownMenuLabel>
        {IMAGE_MODELS.map((model) => (
          <MediaModelItem
            key={model.id}
            model={model}
            activeId={active.id}
            onChange={onChange}
          />
        ))}
        <DropdownMenuSeparator className="my-1 bg-border" />
        <DropdownMenuLabel className="flex items-center gap-2 px-2 py-1.5 text-ui-caption font-medium text-muted-foreground">
          <Clapperboard
            className="size-3.5"
            aria-hidden="true"
            strokeWidth={1.7}
          />
          Video models
        </DropdownMenuLabel>
        {VIDEO_MODELS.map((model) => (
          <MediaModelItem
            key={model.id}
            model={model}
            activeId={active.id}
            onChange={onChange}
          />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
