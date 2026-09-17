"use client";

import { useId, useRef, useState, type PointerEvent } from "react";
import { ChevronDown, RotateCcw } from "lucide-react";
import { RiftLogo } from "@/components/icons/rift-logo";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  getEffectiveBuildModel,
  REASONING_EFFORT_LABELS,
  type ReasoningEffort,
  type SelectedModel,
} from "@/types/chat";
import styles from "./ReasoningEffortSelector.module.css";

type ReasoningEffortSelectorProps = {
  model: SelectedModel;
  value: ReasoningEffort;
  onChange: (effort: ReasoningEffort) => void;
  openDownward?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Render controls inside an existing parameter surface, without a portal. */
  embedded?: boolean;
};

const EFFORT_DETAILS: Record<ReasoningEffort, string> = {
  off: "Reasoning is turned off.",
  on: "Let the model reason through your task.",
  low: "A lighter touch for everyday tasks.",
  medium: "A balance of depth and response time.",
  high: "More room to think through the details.",
  xhigh: "Deeper reasoning for complex challenges.",
  max: "Maximum effort for demanding work.",
};

export function ReasoningEffortSelector({
  model,
  value,
  onChange,
  openDownward = false,
  onOpenChange,
  embedded = false,
}: ReasoningEffortSelectorProps) {
  const descriptionId = useId();
  const [open, setOpen] = useState(false);
  const [dragPosition, setDragPosition] = useState<number | null>(null);
  const [keyboard, setKeyboard] = useState(false);
  const pointerIdRef = useRef<number | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const activeModel = getEffectiveBuildModel(model);
  const efforts: readonly ReasoningEffort[] =
    activeModel.reasoning.supportedEfforts;
  const fixed = efforts.length === 1;
  const selectedIndex = Math.max(0, efforts.indexOf(value));
  const index =
    dragPosition === null
      ? selectedIndex
      : Math.round(dragPosition * (efforts.length - 1));
  const effort = efforts[index];
  const label = REASONING_EFFORT_LABELS[effort];
  const progress = dragPosition ?? (fixed ? 1 : index / (efforts.length - 1));
  const boosted = effort === "xhigh" || effort === "max";

  const cancelDrag = () => {
    pointerIdRef.current = null;
    setDragPosition(null);
  };
  const positionAt = (event: PointerEvent<HTMLInputElement>) => {
    const bounds = trackRef.current?.getBoundingClientRect();
    if (!bounds?.width) return progress;
    return Math.min(
      1,
      Math.max(0, (event.clientX - bounds.left) / bounds.width),
    );
  };
  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) cancelDrag();
    setOpen(nextOpen);
    onOpenChange?.(nextOpen);
  };

  const panel = (
    <>
      <div aria-hidden className={styles.effects}>
        <div className={styles.aura} />
        <div className={styles.surge} />
      </div>
      <div className={styles.header}>
        <div aria-hidden className={styles.core}>
          <RiftLogo size={18} />
        </div>
        <div className={styles.identity}>
          <span className={`rift-menu-heading ${styles.eyebrow}`}>
            Reasoning
          </span>
          <div className={`rift-menu-label ${styles.level}`}>{label}</div>
        </div>
        <button
          type="button"
          aria-label="Reset reasoning effort"
          title="Reset to model default"
          onClick={() => onChange(activeModel.reasoning.defaultEffort)}
          className={styles.reset}
        >
          <RotateCcw aria-hidden className="size-3.5" />
        </button>
      </div>
      <p id={descriptionId} className="sr-only">
        {EFFORT_DETAILS[effort]}
      </p>
      <div className={styles.slider} data-dragging={dragPosition !== null}>
        <div ref={trackRef} aria-hidden className={styles.track}>
          <div
            className={styles.energy}
            style={{ transform: `scaleX(${progress})` }}
          />
          <div className={styles.stops}>
            {efforts.map((stop, stopIndex) => (
              <i key={stop} data-reached={stopIndex <= index} />
            ))}
          </div>
          <div
            className={styles.thumbPosition}
            data-ui="reasoning-effort-thumb"
            style={{ transform: `translateX(${progress * 100}%)` }}
          >
            <div className={styles.thumb}>
              <span />
            </div>
          </div>
        </div>
        <input
          type="range"
          ref={inputRef}
          className="focus-visible:outline-none"
          min={0}
          max={efforts.length - 1}
          step={1}
          value={index}
          aria-label="Reasoning effort"
          aria-valuetext={label}
          aria-describedby={descriptionId}
          onPointerDown={(event) => {
            if (event.button !== 0 || pointerIdRef.current !== null) return;
            // Own pointer movement so the thumb follows every pixel while
            // the provider still receives only a supported, discrete effort.
            event.preventDefault();
            pointerIdRef.current = event.pointerId;
            setKeyboard(false);
            event.currentTarget.focus({ preventScroll: true });
            event.currentTarget.setPointerCapture(event.pointerId);
            setDragPosition(positionAt(event));
          }}
          onPointerMove={(event) => {
            if (pointerIdRef.current === event.pointerId) {
              setDragPosition(positionAt(event));
            }
          }}
          onPointerUp={(event) => {
            if (pointerIdRef.current !== event.pointerId) return;
            const nextIndex = Math.round(
              positionAt(event) * (efforts.length - 1),
            );
            cancelDrag();
            event.currentTarget.releasePointerCapture(event.pointerId);
            if (nextIndex !== selectedIndex) onChange(efforts[nextIndex]);
          }}
          onPointerCancel={(event) => {
            if (pointerIdRef.current === event.pointerId) cancelDrag();
          }}
          onLostPointerCapture={(event) => {
            if (pointerIdRef.current === event.pointerId) cancelDrag();
          }}
          onBlur={cancelDrag}
          onKeyDown={(event) => {
            const nextIndex = {
              ArrowLeft: index - 1,
              ArrowDown: index - 1,
              ArrowRight: index + 1,
              ArrowUp: index + 1,
              Home: 0,
              End: efforts.length - 1,
            }[event.key];
            if (nextIndex === undefined) return;
            setKeyboard(true);
            event.preventDefault();
            cancelDrag();
            const clamped = Math.max(
              0,
              Math.min(efforts.length - 1, nextIndex),
            );
            if (clamped !== selectedIndex) onChange(efforts[clamped]);
          }}
          onChange={(event) => {
            if (pointerIdRef.current === null)
              onChange(efforts[Number(event.target.value)]);
          }}
        />
      </div>
      <div className={styles.scale}>
        <span>{REASONING_EFFORT_LABELS[efforts[0]]}</span>
        <span className={styles.power}>
          {boosted && <RiftLogo size={12} />}
          {boosted ? "Supercharged" : ""}
        </span>
        <span>{REASONING_EFFORT_LABELS[efforts[efforts.length - 1]]}</span>
      </div>
    </>
  );
  if (embedded)
    return (
      <div
        className={`${styles.popover} ${styles.embedded}`}
        data-ui="reasoning-effort-panel"
        data-level={effort}
        data-boosted={boosted}
        data-keyboard="true"
      >
        {panel}
      </div>
    );

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-rift-composer-trigger
          data-ui="reasoning-effort-trigger"
          data-level={effort}
          data-boosted={boosted}
          data-fixed={String(fixed)}
          aria-label={`Reasoning strength: ${REASONING_EFFORT_LABELS[efforts[selectedIndex]]}`}
          disabled={fixed}
          className={`${styles.trigger} h-11 md:h-7`}
          onPointerDown={() => setKeyboard(false)}
          onKeyDown={() => setKeyboard(true)}
        >
          <RiftLogo className={styles.triggerIcon} />
          <span className={styles.triggerLabel}>
            <span>{REASONING_EFFORT_LABELS[efforts[selectedIndex]]}</span>
            {efforts.map((supported) => (
              <span key={supported} aria-hidden className={styles.labelSizer}>
                {REASONING_EFFORT_LABELS[supported]}
              </span>
            ))}
          </span>
          <ChevronDown aria-hidden className={styles.chevron} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        data-rift-composer-menu="effort"
        side={openDownward ? "bottom" : "top"}
        align="end"
        className={styles.popover}
        data-ui="reasoning-effort-popover"
        data-level={effort}
        data-boosted={boosted}
        data-keyboard={keyboard}
        sideOffset={7}
        collisionPadding={12}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          inputRef.current?.focus({ preventScroll: true });
        }}
      >
        {panel}
      </PopoverContent>
    </Popover>
  );
}
