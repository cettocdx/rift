"use client";

import { useEffect, useRef, useState } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { ArrowLeft, Check, ChevronDown, ChevronRight } from "lucide-react";
import { BuildModelLogo } from "@/app/components/ModelSelector/ModelLogo";
import { RiftLogo } from "@/components/icons/rift-logo";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  BUILD_MODELS,
  formatBuildModelContext,
  getEffectiveBuildModel,
  resolveBuildReasoningEffort,
  REASONING_EFFORT_LABELS,
  type SelectedModel,
  type ReasoningEffort,
} from "@/types/chat";
import { COMPOSER_PARAMETER_OPEN_EVENT } from "@/lib/utils/composer-controls";
import { ReasoningEffortSelector } from "./ReasoningEffortSelector";
import styles from "./BuildParametersSelector.module.css";

type Props = {
  value: SelectedModel;
  onChange: (model: SelectedModel) => void;
  reasoningEffort: ReasoningEffort;
  onReasoningChange: (effort: ReasoningEffort) => void;
  openDownward?: boolean;
};

/** Reveal only within the parameter panel, leaving the conversation stationary. */
function focusInPanel(panel: HTMLElement | null, target?: HTMLElement | null) {
  if (!panel || !target) return;
  target.focus({ preventScroll: true });
  const viewport = panel.getBoundingClientRect();
  const option = target.getBoundingClientRect();
  if (option.top < viewport.top + 4)
    panel.scrollTop += option.top - viewport.top - 4;
  else if (option.bottom > viewport.bottom - 4)
    panel.scrollTop += option.bottom - viewport.bottom + 4;
}

/** One portal owns model and reasoning navigation; neither panel opens a popup. */
export function BuildParametersSelector({
  value,
  onChange,
  reasoningEffort,
  onReasoningChange,
  openDownward = false,
}: Props) {
  const isMobile = useIsMobile();
  const active = getEffectiveBuildModel(value);
  const effort = resolveBuildReasoningEffort(value, reasoningEffort);
  const label = REASONING_EFFORT_LABELS[effort];
  const [open, setOpen] = useState(false);
  const [focusRequest, requestFocus] = useState(0);
  const [view, setView] = useState<"overview" | "model" | "effort">("overview");
  const returnTo = useRef<"model" | "effort">("model");
  const content = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const button = trigger.current;
    if (!button) return;
    const openParameter = (event: Event) => {
      const detail = event instanceof CustomEvent ? event.detail : undefined;
      if (detail !== "model" && detail !== "effort") return;
      event.preventDefault();
      returnTo.current = detail;
      setView(detail);
      setOpen(true);
      requestFocus((previous) => previous + 1);
    };
    button.addEventListener(COMPOSER_PARAMETER_OPEN_EVENT, openParameter);
    return () =>
      button.removeEventListener(COMPOSER_PARAMETER_OPEN_EVENT, openParameter);
  }, []);
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      const selector =
        view === "model"
          ? '[aria-checked="true"]'
          : view === "effort"
            ? 'input[type="range"]'
            : `[data-parameter="${returnTo.current}"]`;
      const target = content.current?.querySelector<HTMLElement>(selector);
      focusInPanel(content.current, target);
    });
    return () => cancelAnimationFrame(frame);
  }, [open, view, focusRequest]);
  const show = (next: "model" | "effort") => {
    returnTo.current = next;
    setView(next);
  };
  const back = () => setView("overview");

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setView("overview");
          returnTo.current = "model";
        }
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          ref={trigger}
          data-rift-parameter-control
          data-rift-composer-trigger
          data-ui="model-selector-trigger"
          data-open-direction={openDownward ? "down" : "up"}
          aria-label={`Build model: ${active.model}, effort: ${label}`}
          title={`${active.provider}: ${active.model}. ${formatBuildModelContext(active.contextTokens)}. ${active.capabilities.join(", ")}. Effort: ${label}.`}
          className={styles.trigger}
        >
          <BuildModelLogo family={active.family} />
          <span data-ui="model-selector-label" className={styles.modelLabel}>
            {active.model}
          </span>
          <span data-ui="model-effort-label" className={styles.effortLabel}>
            <RiftLogo size={12} />
            {label}
          </span>
          <ChevronDown aria-hidden className={styles.chevron} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        ref={content}
        aria-label="Model parameters"
        data-view={view}
        data-rift-composer-menu="model"
        data-ui="model-selector-menu"
        data-open-direction={openDownward ? "down" : "up"}
        side={openDownward ? "bottom" : "top"}
        align="start"
        sideOffset={6}
        collisionPadding={8}
        className={styles.popover}
        onOpenAutoFocus={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => {
          if (view !== "overview") {
            event.preventDefault();
            back();
          }
        }}
      >
        {view === "overview" ? (
          <>
            <button
              type="button"
              className={`${styles.row} ${isMobile ? styles.mobileModel : ""}`}
              data-parameter="model"
              aria-label={`Model: ${active.model}`}
              onClick={() => show("model")}
            >
              {!isMobile && <span>Model</span>}
              <span className={styles.value}>{active.model}</span>
              <ChevronRight aria-hidden />
            </button>
            {isMobile ? (
              <ReasoningEffortSelector
                key={active.id}
                embedded
                model={value}
                value={effort}
                onChange={onReasoningChange}
              />
            ) : (
              <>
                <div className={`${styles.row} ${styles.context}`}>
                  <span>Context</span>
                  <span className={styles.value}>
                    {formatBuildModelContext(active.contextTokens)}
                  </span>
                </div>
                <button
                  type="button"
                  className={styles.row}
                  data-parameter="effort"
                  aria-label={`Effort: ${label}`}
                  onClick={() => show("effort")}
                >
                  <RiftLogo size={13} />
                  <span>Effort</span>
                  <span className={styles.value}>{label}</span>
                  <ChevronRight aria-hidden />
                </button>
              </>
            )}
          </>
        ) : (
          <>
            <button
              type="button"
              className={`${styles.row} ${styles.back}`}
              aria-label="Back to model parameters"
              onClick={back}
            >
              <ArrowLeft aria-hidden />
              {view === "model" ? "Model" : "Effort"}
            </button>
            {view === "model" ? (
              <div role="radiogroup" aria-label="Build model">
                {BUILD_MODELS.map((model, index) => (
                  <button
                    key={model.id}
                    type="button"
                    role="radio"
                    aria-checked={model.id === active.id}
                    aria-label={`${model.model}, ${formatBuildModelContext(model.contextTokens)}`}
                    tabIndex={model.id === active.id ? 0 : -1}
                    className={styles.row}
                    title={`${model.desc}. ${model.capabilities.join(", ")}.`}
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
                            ? BUILD_MODELS.length - 1
                            : delta !== undefined
                              ? (index + delta + BUILD_MODELS.length) %
                                BUILD_MODELS.length
                              : undefined;
                      if (next === undefined) return;
                      event.preventDefault();
                      onChange(BUILD_MODELS[next].id);
                      focusInPanel(
                        content.current,
                        event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
                          '[role="radio"]',
                        )[next],
                      );
                    }}
                    onClick={() => {
                      onChange(model.id);
                      back();
                    }}
                  >
                    <BuildModelLogo family={model.family} />
                    <span className={styles.modelName}>{model.model}</span>
                    {model.id === active.id && <Check aria-hidden />}
                  </button>
                ))}
              </div>
            ) : (
              <ReasoningEffortSelector
                key={active.id}
                embedded
                model={value}
                value={effort}
                onChange={onReasoningChange}
              />
            )}
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
