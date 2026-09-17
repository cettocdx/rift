"use client";

import { Check, ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useGlobalState } from "@/app/contexts/GlobalState";
import {
  BUILD_MODELS,
  MEDIA_MODELS,
  formatBuildModelContext,
  getEffectiveBuildModel,
  type ChatMode,
} from "@/types/chat";
import {
  AGENT_MODEL_OPTIONS,
  ASK_MODEL_OPTIONS,
} from "@/app/components/ModelSelector/constants";
import { isAgentMode } from "@/lib/utils/mode-helpers";
import { useHydrated } from "@/app/hooks/useHydrated";
import {
  BuildModelLogo,
  MediaModelLogo,
} from "@/app/components/ModelSelector/ModelLogo";

export function getWorkspaceModeLabel(mode: ChatMode | null | undefined) {
  return mode === "agent" ? "Agent" : "Plan";
}

const MODES: { value: ChatMode; label: string }[] = [
  { value: "ask", label: "Plan" },
  { value: "agent", label: "Agent" },
];

export function ProTitlebarModelMenu() {
  const hydrated = useHydrated();
  const {
    chatMode,
    setChatMode,
    selectedModel,
    setSelectedModel,
    chatPurpose,
  } = useGlobalState();
  const visibleChatMode = hydrated ? chatMode : "ask";
  const visibleModel = hydrated ? selectedModel : "auto";
  const buildModel = getEffectiveBuildModel(visibleModel);
  const mediaModel = MEDIA_MODELS.find((model) => model.id === visibleModel);
  const label = `${getWorkspaceModeLabel(visibleChatMode)} / ${
    chatPurpose === "app" ? buildModel.model : (visibleModel ?? "auto")
  }`;
  const modelOptions = isAgentMode(visibleChatMode)
    ? AGENT_MODEL_OPTIONS
    : ASK_MODEL_OPTIONS;

  if (chatPurpose === "image") {
    return (
      <span className="hidden items-center gap-1.5 rounded-md border border-border bg-muted/60 px-2 py-0.5 text-ui-caption text-muted-foreground sm:inline-flex">
        {mediaModel && <MediaModelLogo model={mediaModel.id} size={14} />}
        media / {mediaModel?.name ?? visibleModel ?? "auto"}
      </span>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Mode and model: ${label}`}
          className="hidden cursor-pointer items-center gap-1 rounded border border-border bg-muted/60 px-2 py-0.5 font-mono text-ui-caption text-muted-foreground outline-none transition-colors hover:border-border-strong hover:bg-accent hover:text-foreground motion-reduce:transition-none sm:inline-flex"
        >
          {chatPurpose === "app" && (
            <BuildModelLogo family={buildModel.family} size={14} />
          )}
          {label}
          <ChevronDown aria-hidden="true" className="size-3 opacity-60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        collisionPadding={8}
        className="pro-dropdown w-[300px] max-w-[calc(100vw-16px)]"
      >
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          Mode
        </DropdownMenuLabel>
        {MODES.map((m) => (
          <DropdownMenuItem
            key={m.value}
            aria-current={chatMode === m.value ? "true" : undefined}
            onSelect={() => setChatMode(m.value)}
          >
            {m.label}
            {chatMode === m.value ? (
              <Check aria-hidden="true" className="ml-auto size-3.5" />
            ) : null}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          Model
        </DropdownMenuLabel>
        {chatPurpose === "app" ? (
          BUILD_MODELS.map((model) => {
            const isActive = buildModel.id === model.id;
            const context = formatBuildModelContext(model.contextTokens);
            return (
              <DropdownMenuItem
                key={model.id}
                aria-current={isActive ? "true" : undefined}
                aria-label={`${model.model}, ${model.provider} ${model.family}, ${context}`}
                title={`${model.desc}. ${model.capabilities.join(", ")}.`}
                onSelect={() => setSelectedModel(model.id)}
                className="flex cursor-pointer items-start gap-2 py-1.5"
              >
                <BuildModelLogo family={model.family} />
                <span className="min-w-0 flex-1 leading-tight">
                  <span className="block truncate text-ui-label font-medium text-foreground">
                    {model.model}
                  </span>
                  <span className="mt-0.5 block truncate text-ui-caption text-muted-foreground">
                    {model.family} / {model.label} / {context}
                  </span>
                </span>
                <Check
                  aria-hidden="true"
                  className={`mt-0.5 size-3.5 shrink-0 ${
                    isActive ? "text-foreground" : "text-transparent"
                  }`}
                />
              </DropdownMenuItem>
            );
          })
        ) : (
          <>
            <DropdownMenuItem
              aria-current={selectedModel === "auto" ? "true" : undefined}
              onSelect={() => setSelectedModel("auto")}
            >
              Auto
              {selectedModel === "auto" ? (
                <Check aria-hidden="true" className="ml-auto size-3.5" />
              ) : null}
            </DropdownMenuItem>
            {modelOptions.map((m) => (
              <DropdownMenuItem
                key={m.id}
                aria-current={selectedModel === m.id ? "true" : undefined}
                onSelect={() => setSelectedModel(m.id)}
              >
                {m.label}
                {selectedModel === m.id ? (
                  <Check aria-hidden="true" className="ml-auto size-3.5" />
                ) : null}
              </DropdownMenuItem>
            ))}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
