/** Shared navigation geometry for the workspace and its product previews.
 * Live Cursor desktop: 30px rows, 13/18 text at weight 418, -0.08px tracking.
 * Keep the requested 16px outline icons. Active rows retain the same weight.
 * Keep the virtualized list height in sync with sidebarNavRowClass.
 */
export const SIDEBAR_ROW_HEIGHT_PX = 30;

export function sidebarNavRowClass(active: boolean): string {
  return `rift-sidebar-row flex h-[30px] w-full items-center gap-2 rounded-[6px] px-1.5 text-[13px] font-[418] leading-[18px] tracking-[-0.08px] text-sidebar-foreground transition-colors duration-(--duration-press) ease-(--ease-out) focus-visible:outline-none focus-visible:bg-sidebar-accent [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-[var(--cursor-icon-secondary)] ${
    active
      ? "bg-sidebar-accent text-sidebar-foreground [&>svg]:text-sidebar-foreground"
      : // A row is too wide to scale on press without looking like it moved,
        // so the press is a fill one step past hover. Without it these rows —
        // the most-clicked controls in the product — answered nothing at all
        // between the click and the route arriving.
        "text-[var(--cursor-text-secondary)] hover:bg-sidebar-accent hover:text-sidebar-foreground hover:[&>svg]:text-sidebar-foreground active:bg-sidebar-accent"
  }`;
}

/**
 * Collapsible sidebar SECTION label (Projects / Recent). One step down from a
 * nav row in size only — 12px on a 16px line at weight 418, normal tracking —
 * which is what keeps it a quieter member of the same system rather than a
 * different one. Cursor's own section labels ("Repositories", "Yesterday")
 * sit one size below its rows, which is the step this keeps.
 */
export const SIDEBAR_SECTION_LABEL_CLASS =
  "rift-sidebar-section-label text-[12px] font-[418] leading-4 tracking-normal text-[var(--cursor-text-tertiary)] transition-colors";

/** Run counters, as a terminal status line across the top of the activity panel. */
/**
 * One line, and it stays one line. Wrapping put the run's token count on a row
 * of its own, right-aligned under the counters, where it read as a stray number
 * rather than part of the status line. The header below carries the rule for
 * the pair, so this row does not draw a second one.
 */
export const ACTIVITY_COUNTERS_ROW_CLASS =
  "flex min-h-8 items-center gap-x-3 overflow-hidden px-3 py-1.5 text-[10.5px] font-medium text-muted-foreground";

/** Section heading inside the activity panel (Plan, Subagents, Operations). */
export const ACTIVITY_SECTION_TITLE_CLASS =
  "text-[12px] font-medium text-foreground";

/** The "3 / 5" counter beside a section heading. */
export const ACTIVITY_SECTION_COUNT_CLASS =
  "text-[11px] font-medium tabular-nums text-muted-foreground";

/*
 * The operation trace.
 *
 * Measured from Grok's own run trace on 17 Aug 2026 (see
 * docs/product-transformation/grok-agent-behaviour-2026-08-17.md). The numbers
 * are not stylistic preferences — they are what was on the page:
 *
 *   row height 24px, row pitch 32px (an 8px gap)
 *   icon 14x14 at stroke-width 1, on the same colour as the verb
 *   icon left edge to verb text: 11px
 *   verb to argument: 6px, aligned on the BASELINE rather than centred
 *   verb   14px / 24px   rgb(158,158,158)   -0.1px tracking
 *   argument 14px / 19.25px rgb(133,133,133) -0.1px tracking, truncating
 *   a 1x5px connector tick at 20% white, on the icon's centre line
 *
 * Two contrast registers and nothing else: the verb leads, the argument
 * recedes, and hovering the row promotes both one step. There is deliberately
 * no trailing status icon and no step number — status lives in the verb's
 * tense, and the reader counts nothing.
 */

/** One row in the trace. 24px tall; the connector below it makes up the 32px pitch. */
export const ACTIVITY_ROW_CLASS =
  "group/row flex h-6 w-full items-center gap-[11px] text-left focus-visible:outline-none";

/** The leading glyph. Same colour as the verb, so the pair reads as one unit. */
export const ACTIVITY_ICON_CLASS =
  "flex size-[14px] shrink-0 items-center justify-center text-[var(--cursor-text-secondary)] transition-colors group-hover/row:text-foreground";

/** Verb and argument share a baseline; the argument is what truncates. */
export const ACTIVITY_LABEL_GROUP_CLASS =
  "flex min-w-0 items-baseline gap-1.5 leading-6";

/*
 * Message-sized content (14px at the default UI size).
 *
 * This was dropped to 12px to match the Plan and Subagents rows above it, on
 * the reasoning that one panel should not run two type sizes. Read on the
 * screen instead of in the argument, that was wrong: Operations is the list
 * people actually follow while a run is working, it is the longest list in the
 * pane, and at 12px it became the hardest thing in the product to read. The
 * consistency it bought was not worth what it cost the reader.
 *
 * So the size difference is deliberate now, not an oversight: the trace is the
 * content of this pane and the section headings are labels on it.
 */
export const ACTIVITY_VERB_CLASS =
  "whitespace-nowrap text-[length:var(--rift-type-message)] leading-6 tracking-[-0.1px] text-[var(--cursor-text-secondary)] transition-colors group-hover/row:text-foreground";

export const ACTIVITY_ARG_CLASS =
  "min-w-0 truncate text-[length:var(--rift-type-message)] leading-snug tracking-[-0.1px] text-[var(--cursor-text-tertiary)] transition-colors group-hover/row:text-[var(--cursor-text-secondary)]";

/** Paths, commands, and search terms take the mono variant one step down, so a
 *  long path does not outrun its own row -- mono runs wide at the same size. */
export const ACTIVITY_ARG_MONO_CLASS =
  "min-w-0 truncate font-mono text-[length:var(--rift-type-body)] leading-6 tracking-[-0.1px] text-[var(--cursor-text-tertiary)] transition-colors group-hover/row:text-[var(--cursor-text-secondary)]";

/**
 * The thread between two rows: an 8px gap carrying a 1x5px tick, centred on the
 * icon column (7px in from the row's leading edge).
 */
export const ACTIVITY_CONNECTOR_CLASS = "flex h-2 items-center";
export const ACTIVITY_CONNECTOR_TICK_CLASS =
  "ms-[6.5px] h-[5px] w-px bg-foreground/20";

export type PlanStepStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "cancelled";

/** A single plan step. The in-progress row is the only one that gets a fill. */
export function activityPlanRowClass(status: PlanStepStatus): string {
  // No rule between steps. A plan is one list, and a hairline under every line
  // of it turns six steps into six cards; neither reference app rules its own
  // step lists. The active step is marked by its fill, which is enough.
  return `flex min-h-8 items-start gap-2 rounded-[6px] px-2 py-1.5 text-[12px] leading-5 ${
    status === "in_progress"
      ? "bg-foreground/[0.035] text-foreground"
      : status === "pending"
        ? "text-[var(--cursor-text-secondary)]"
        : "text-muted-foreground"
  }`;
}

/** The status glyph slot on a plan step. */
export function activityPlanIconClass(status: PlanStepStatus): string {
  return `mt-0.5 flex size-4 shrink-0 items-center justify-center ${
    status === "in_progress"
      ? "text-[var(--cursor-text-secondary)]"
      : status === "completed"
        ? "text-[var(--success)]"
        : status === "cancelled"
          ? "text-destructive"
          : "text-muted-foreground"
  }`;
}
