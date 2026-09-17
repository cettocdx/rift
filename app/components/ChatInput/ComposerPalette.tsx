"use client";

import {
  type CSSProperties,
  type RefObject,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useQuery } from "convex/react";
import { isMcpServerUsable } from "@/lib/ai/mcp/mcp-usability";
import { Bot, Plug, Sparkles, UsersRound, type LucideIcon } from "lucide-react";
import { api } from "@/convex/_generated/api";
import {
  CONTEXT_SOURCES,
  getComposerSlashCommands,
} from "@/lib/composer/palette-items";
import {
  AGENT_PET_ROSTER,
  MANAGED_AGENT_ROSTER_SKILL_ID,
  parseAgentRosterConfiguration,
} from "@/lib/ai/agents/pet-roster";
import { openShortcutsDialog } from "@/app/components/pro/ProShortcutsDialog";
import { useTauri } from "@/app/hooks/useTauri";
import type { ChatPurpose } from "@/types/chat";
import styles from "./ComposerPalette.module.css";

type PaletteMode = "context" | "slash" | null;
type PaletteItem = {
  id: string;
  label: string;
  description: string;
  icon: LucideIcon;
  insert?: string;
  command?: string;
  argumentHint?: string;
  category?: string;
  group?: string;
  keybinding?: string;
  shortcut?: string | readonly string[];
  aliases?: readonly string[];
};
type OptionalMetadataKey =
  | "argumentHint"
  | "category"
  | "group"
  | "keybinding"
  | "shortcut";

interface ComposerPaletteProps {
  input: string;
  inputRef?: RefObject<HTMLTextAreaElement | null>;
  cursorAt: number;
  inputRevision: number;
  onApply: (next: string, cursorAt?: number) => void;
  onClear?: () => void;
  proShell?: boolean;
  purpose?: ChatPurpose;
}

type DismissedPalette = Readonly<{
  input: string;
  inputRevision: number;
}>;

interface PaletteGroup {
  label: string | null;
  entries: Array<{ item: PaletteItem; index: number }>;
}

interface PaletteLayout {
  bottom?: number;
  compact: boolean;
  detailsMaxHeight: number;
  left: number;
  listMaxHeight: number;
  maxHeight: number;
  placement: "top" | "bottom";
  showFooter: boolean;
  showHeader: boolean;
  top?: number;
  width: number;
}

interface ViewportBounds {
  bottom: number;
  height: number;
  left: number;
  right: number;
  top: number;
  width: number;
}

const PALETTE_GAP = 8;
const VIEWPORT_PADDING = 8;
const PALETTE_HEADER_HEIGHT = 32;
const PALETTE_FOOTER_HEIGHT = 28;
const PALETTE_FRAME_HEIGHT = 2;
const MIN_TOP_SPACE = 176;
const MIN_LIST_HEIGHT = 64;
const MAX_LIST_HEIGHT = 288;
const MAX_PALETTE_WIDTH = 400;

function contextId(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const useSafeLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

function getViewportBounds(): ViewportBounds {
  const visualViewport = window.visualViewport;
  const left = visualViewport?.offsetLeft ?? 0;
  const top = visualViewport?.offsetTop ?? 0;
  const width = visualViewport?.width ?? window.innerWidth;
  const height = visualViewport?.height ?? window.innerHeight;

  return {
    bottom: top + height,
    height,
    left,
    right: left + width,
    top,
    width,
  };
}

function getPaletteLayout(anchor: DOMRect, hasDetails: boolean): PaletteLayout {
  const viewport = getViewportBounds();
  const maxViewportWidth = Math.max(0, viewport.width - VIEWPORT_PADDING * 2);
  const measuredWidth = anchor.width > 0 ? anchor.width : MAX_PALETTE_WIDTH;
  const width = Math.min(MAX_PALETTE_WIDTH, maxViewportWidth, measuredWidth);
  const left = Math.min(
    Math.max(viewport.left + VIEWPORT_PADDING, anchor.left),
    Math.max(
      viewport.left + VIEWPORT_PADDING,
      viewport.right - VIEWPORT_PADDING - width,
    ),
  );
  const visibleTop = viewport.top + VIEWPORT_PADDING;
  const visibleBottom = viewport.bottom - VIEWPORT_PADDING;
  const standardSpace = Math.max(
    0,
    Math.min(visibleBottom, anchor.top - PALETTE_GAP) - visibleTop,
    visibleBottom - Math.max(visibleTop, anchor.bottom + PALETTE_GAP),
  );
  // Recover four pixels of separation only at the one-control boundary:
  // a 44px action needs 46px including this menu's borders.
  const gap =
    hasDetails && standardSpace < 44 + PALETTE_FRAME_HEIGHT ? 4 : PALETTE_GAP;
  // When the virtual keyboard covers the composer, keep the palette edge in
  // the remaining visual viewport instead of anchoring it under the keyboard.
  const aboveEdge = Math.min(visibleBottom, anchor.top - gap);
  const belowEdge = Math.max(visibleTop, anchor.bottom + gap);
  const spaceAbove = Math.max(0, aboveEdge - visibleTop);
  const spaceBelow = Math.max(0, visibleBottom - belowEdge);
  const placement =
    spaceAbove >= MIN_TOP_SPACE || spaceAbove >= spaceBelow ? "top" : "bottom";
  const availableHeight = placement === "top" ? spaceAbove : spaceBelow;
  const showHeader = !hasDetails || availableHeight >= 146;
  const showFooter =
    availableHeight >=
    PALETTE_HEADER_HEIGHT +
      PALETTE_FOOTER_HEIGHT +
      PALETTE_FRAME_HEIGHT +
      MIN_LIST_HEIGHT +
      (hasDetails ? 96 : 0);
  const chromeHeight =
    (showHeader ? PALETTE_HEADER_HEIGHT : 0) +
    (showFooter ? PALETTE_FOOTER_HEIGHT : 0) +
    PALETTE_FRAME_HEIGHT;
  const contentHeight = Math.max(0, availableHeight - chromeHeight);
  const detailsMaxHeight = hasDetails
    ? Math.min(192, Math.floor(contentHeight * 0.45))
    : 0;
  // Keep both independent scrollports only while a full action can be
  // revealed, including the help's bottom padding/border and list padding.
  const compact =
    hasDetails &&
    (detailsMaxHeight < 44 + 8 + 1 ||
      contentHeight - detailsMaxHeight < 44 + 4);
  const listMaxHeight = Math.max(
    compact ? 48 : 0,
    Math.min(
      MAX_LIST_HEIGHT,
      compact ? contentHeight : contentHeight - detailsMaxHeight,
    ),
  );

  return {
    bottom: placement === "top" ? window.innerHeight - aboveEdge : undefined,
    compact,
    detailsMaxHeight,
    left,
    listMaxHeight,
    maxHeight: availableHeight,
    placement,
    showFooter,
    showHeader,
    top: placement === "bottom" ? belowEdge : undefined,
    width,
  };
}

function sameLayout(current: PaletteLayout | null, next: PaletteLayout) {
  return (
    current?.bottom === next.bottom &&
    current?.compact === next.compact &&
    current?.detailsMaxHeight === next.detailsMaxHeight &&
    current?.left === next.left &&
    current?.listMaxHeight === next.listMaxHeight &&
    current?.maxHeight === next.maxHeight &&
    current?.placement === next.placement &&
    current?.showFooter === next.showFooter &&
    current?.showHeader === next.showHeader &&
    current?.top === next.top &&
    current?.width === next.width
  );
}

/** Reveal only inside this menu's scrollports, never the chat/document. */
function revealInPanel(target: HTMLElement | null, panel: HTMLElement | null) {
  if (!target || !panel) return;
  const targetBox = target.getBoundingClientRect();
  const panelBox = panel.getBoundingClientRect();
  // Entrance animation scales these rectangles, but not scrollTop. Convert
  // back to layout coordinates so an immediate End does not under-scroll.
  const ratio =
    panel.offsetHeight > 0 ? panelBox.height / panel.offsetHeight : 1;
  const scale = Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
  const top = panelBox.top + panel.clientTop * scale;
  const height = panel.clientHeight * scale;
  const bottom = top + height;
  if (targetBox.top < top || targetBox.height > height) {
    panel.scrollTop += (targetBox.top - top) / scale;
  } else if (targetBox.bottom > bottom) {
    panel.scrollTop += (targetBox.bottom - bottom) / scale;
  }
}

function triggerAtCursor(value: string, cursor: number, trigger: string) {
  const before = value.slice(0, cursor);
  const match = before.match(
    new RegExp(`(?:^|[\\s])(${trigger.replace("/", "\\/")}[^\\s]*)$`),
  );
  if (!match) return null;
  const token = match[1];
  const start = before.length - token.length;
  return { token, query: token.slice(1), start, end: cursor };
}

function optionalText(
  item: PaletteItem,
  ...keys: OptionalMetadataKey[]
): string | null {
  const record = item as unknown as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (Array.isArray(value)) {
      const text = value
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter(Boolean)
        .join(" ");
      if (text) return text;
    }
  }
  return null;
}

function groupItems(items: PaletteItem[]): PaletteGroup[] {
  const groups: PaletteGroup[] = [];
  items.forEach((item, index) => {
    const label = optionalText(item, "group", "category");
    const previous = groups.at(-1);
    const group =
      previous?.label === label
        ? previous
        : (() => {
            const next = { label, entries: [] } satisfies PaletteGroup;
            groups.push(next);
            return next;
          })();
    group.entries.push({ item, index });
  });
  return groups;
}

function matchesQuery(item: PaletteItem, query: string) {
  if (!query) return true;
  const searchable = [
    item.id,
    item.label,
    item.description,
    optionalText(item, "group"),
    optionalText(item, "category"),
    optionalText(item, "argumentHint"),
    optionalText(item, "shortcut", "keybinding"),
    ...(item.aliases ?? []),
  ];
  return searchable.some((value) => value?.toLowerCase().includes(query));
}

function filterSlashItems(items: PaletteItem[], query: string) {
  if (!query) return items;
  const prefixMatches = items.filter((item) =>
    [item.id, ...(item.aliases ?? [])].some((name) =>
      name.toLowerCase().startsWith(query),
    ),
  );
  return prefixMatches.length > 0
    ? prefixMatches
    : items.filter((item) => matchesQuery(item, query));
}

function isExactSlashInvocation(item: PaletteItem | undefined, input: string) {
  if (!item) return false;
  const invocation = input.trim().toLowerCase();
  return [item.id, ...(item.aliases ?? [])].some(
    (name) => invocation === `/${name.toLowerCase()}`,
  );
}

export function ComposerPalette({
  input,
  inputRef,
  cursorAt,
  inputRevision,
  onApply,
  onClear,
  proShell,
  purpose = "app",
}: ComposerPaletteProps) {
  const { isTauri } = useTauri();
  const skills = useQuery(api.skills.listForUser, proShell ? {} : "skip");
  const mcpServers = useQuery(
    api.mcpServers.listForUser,
    proShell ? {} : "skip",
  );
  // A coarse clock (30s) used only to age out the MCP retry cooldown so the
  // composer offers exactly what the runtime would run. Seeded in a lazy
  // initializer and advanced by an interval, never read from Date.now() during
  // render.
  const [usabilityNow, setUsabilityNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setUsabilityNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  const paletteId = useId();
  const anchorRef = useRef<HTMLSpanElement>(null);
  const paletteRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const detailsRef = useRef<HTMLDivElement>(null);
  const touchOptionRef = useRef<string | null>(null);
  const inspectTouchRef = useRef(false);
  const [layout, setLayout] = useState<PaletteLayout | null>(null);
  const [dismissedTrigger, setDismissedTrigger] =
    useState<DismissedPalette | null>(null);
  const [selection, setSelection] = useState<{
    trigger: string;
    index: number;
  } | null>(null);
  const cursor = Math.min(input.length, Math.max(0, cursorAt));
  const contextTrigger = proShell ? triggerAtCursor(input, cursor, "@") : null;
  const slashTrigger = triggerAtCursor(input, cursor, "/");
  const trigger = slashTrigger ?? contextTrigger;
  const candidateMode: PaletteMode = slashTrigger
    ? "slash"
    : contextTrigger
      ? "context"
      : null;
  const triggerKey = trigger
    ? `${inputRevision}:${candidateMode}:${trigger.start}:${trigger.end}:${trigger.token}`
    : null;
  const isDismissed =
    dismissedTrigger?.input === input &&
    dismissedTrigger.inputRevision === inputRevision;
  const mode = isDismissed ? null : candidateMode;
  const query = mode && trigger ? trigger.query.toLowerCase() : "";
  const rangeStart = mode && trigger ? trigger.start : null;
  const rangeEnd = mode && trigger ? trigger.end : null;

  const dynamicContextSources = useMemo<PaletteItem[]>(() => {
    if (!proShell) return [];
    const managedRoster = skills?.find(
      (skill) =>
        skill.enabled && skill.catalog_id === MANAGED_AGENT_ROSTER_SKILL_ID,
    );
    const roster = parseAgentRosterConfiguration(managedRoster?.instructions);
    const agentItems: PaletteItem[] = roster
      ? [
          ...roster.workflowAgentIds.flatMap((agentId) => {
            const agent = AGENT_PET_ROSTER.find(
              (candidate) => candidate.id === agentId,
            );
            if (!agent) return [];
            const mention = `@agent:${agent.petName.toLowerCase()}`;
            return [
              {
                id: `agent:${agent.petName.toLowerCase()}`,
                label: `${agent.petName} · ${agent.roleName}`,
                description: agent.description,
                icon: Bot,
                insert: `${mention} `,
                command: mention,
                group: "Agents",
              },
            ];
          }),
          ...roster.customAgents
            .filter((agent) => agent.enabled)
            .map((agent) => ({
              id: agent.mention.slice(1),
              label: `${agent.name} · ${agent.roleName}`,
              description: agent.mission,
              icon: Bot,
              insert: `${agent.mention} `,
              command: agent.mention,
              group: "Agents",
            })),
        ]
      : [];
    const teamItems: PaletteItem[] = (roster?.teams ?? [])
      .filter((team) => team.enabled)
      .map((team) => ({
        id: team.mention.slice(1),
        label: team.name,
        description: team.goal,
        icon: UsersRound,
        insert: `${team.mention} `,
        command: team.mention,
        group: "Teams",
      }));
    const skillItems: PaletteItem[] = (skills ?? [])
      .filter(
        (skill) =>
          skill.enabled && skill.catalog_id !== MANAGED_AGENT_ROSTER_SKILL_ID,
      )
      .map((skill) => {
        const catalogId = skill.catalog_id;
        return {
          id: `skill:${catalogId ?? String(skill._id)}`,
          label: skill.name,
          description: skill.description,
          icon: Sparkles,
          insert: catalogId
            ? `$${catalogId} `
            : `Use the installed “${skill.name}” skill `,
          command: catalogId ? `$${catalogId}` : `@skill:${skill.name}`,
          group: "Skills",
        };
      });
    const mcpItems: PaletteItem[] = (mcpServers ?? [])
      // Offer exactly what the agent runtime would actually load, so a working
      // plugin the runtime uses is never hidden here for not being "verified".
      .filter((server) => isMcpServerUsable(server, usabilityNow))
      .map((server) => ({
        id: `mcp:${contextId(server.name)}:${String(server._id)}`,
        label: server.name,
        description: `Use tools from the ${server.name} connection`,
        icon: Plug,
        insert: `Use the “${server.name}” MCP tools `,
        command: `@mcp:${server.name}`,
        group: "MCP",
      }));
    return [...agentItems, ...teamItems, ...skillItems, ...mcpItems];
  }, [mcpServers, proShell, skills, usabilityNow]);

  const items = useMemo<PaletteItem[]>(() => {
    if (mode === "context") {
      return [...CONTEXT_SOURCES, ...dynamicContextSources].filter((item) =>
        matchesQuery(item, query),
      );
    }
    if (mode === "slash") {
      return filterSlashItems(
        getComposerSlashCommands({
          purpose,
          surface: isTauri ? "desktop" : "web",
        }),
        query,
      );
    }
    return [];
  }, [dynamicContextSources, isTauri, mode, purpose, query]);
  const groups = useMemo(() => groupItems(items), [items]);

  const active =
    triggerKey && selection?.trigger === triggerKey
      ? Math.min(selection.index, Math.max(0, items.length - 1))
      : 0;

  const activeItem = items[active];
  const activeOptionId = activeItem
    ? `${paletteId}-option-${activeItem.id}-${active}`
    : undefined;
  const listboxId = `${paletteId}-listbox`;

  useEffect(() => {
    const composer = inputRef?.current;
    if (!composer) return;

    composer.setAttribute("aria-autocomplete", "list");
    if (mode) {
      composer.setAttribute("aria-controls", listboxId);
    } else {
      composer.removeAttribute("aria-controls");
    }
    if (activeOptionId) {
      composer.setAttribute("aria-activedescendant", activeOptionId);
    } else {
      composer.removeAttribute("aria-activedescendant");
    }

    return () => {
      composer.removeAttribute("aria-activedescendant");
      composer.removeAttribute("aria-autocomplete");
      composer.removeAttribute("aria-controls");
    };
  }, [activeOptionId, inputRef, listboxId, mode]);

  const updateActive = useCallback(
    (next: number | ((current: number) => number)) => {
      if (!triggerKey || items.length === 0) return;
      setSelection((currentSelection) => {
        const current =
          currentSelection?.trigger === triggerKey
            ? Math.min(currentSelection.index, items.length - 1)
            : 0;
        const requested = typeof next === "function" ? next(current) : next;
        return {
          trigger: triggerKey,
          index: Math.min(items.length - 1, Math.max(0, requested)),
        };
      });
    },
    [items.length, triggerKey],
  );

  const applyItem = useCallback(
    (index: number) => {
      if (!mode || rangeStart === null || rangeEnd === null) return;
      const item = items[index];
      if (!item) return;
      const before = input.slice(0, rangeStart);
      const after = input.slice(rangeEnd);
      let dismissedInput = input;
      let nextCursor = cursor;

      if (mode === "slash" && item.id === "help") {
        openShortcutsDialog();
        dismissedInput = before + after;
        nextCursor = before.length;
        onApply(dismissedInput, nextCursor);
      } else if (mode === "slash" && item.id === "clear") {
        onClear?.();
        dismissedInput = "";
        nextCursor = 0;
        onApply("", 0);
      } else {
        const insert = ("insert" in item ? item.insert : "") ?? "";
        const next = before + insert + after;
        nextCursor = before.length + insert.length;
        dismissedInput = next;
        onApply(next, nextCursor);
      }
      // Dismiss the resulting value, not the pre-apply revision. Commands such
      // as /model intentionally insert the exact text already in the composer;
      // tying dismissal to inputRevision would reopen the palette immediately
      // and make every subsequent Enter reapply the same suggestion forever.
      setDismissedTrigger({
        input: dismissedInput,
        inputRevision: inputRevision + 1,
      });
    },
    [
      cursor,
      input,
      inputRevision,
      items,
      mode,
      onApply,
      onClear,
      rangeEnd,
      rangeStart,
    ],
  );

  useEffect(() => {
    if (!mode || rangeStart === null || rangeEnd === null) return;

    const onKeyDown = (event: KeyboardEvent) => {
      const composer = inputRef?.current;
      const ownsEvent = composer
        ? event.target === composer
        : event.target instanceof HTMLTextAreaElement &&
          event.target.dataset.testid === "chat-input";
      if (!ownsEvent) {
        return;
      }
      // This capture listener runs before the textarea's editing/IME guards.
      // Only plain palette keys belong here; leave candidate confirmation,
      // selection shortcuts, newlines and backward tab navigation untouched.
      if (
        event.isComposing ||
        event.keyCode === 229 ||
        event.shiftKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey
      ) {
        return;
      }

      switch (event.key) {
        case "F1":
          if (!detailsRef.current) return;
          event.preventDefault();
          revealInPanel(detailsRef.current, paletteRef.current);
          detailsRef.current.focus({ preventScroll: true });
          break;
        case "ArrowDown":
          if (items.length === 0) return;
          event.preventDefault();
          updateActive((current) => (current + 1) % items.length);
          break;
        case "ArrowUp":
          if (items.length === 0) return;
          event.preventDefault();
          updateActive(
            (current) => (current - 1 + items.length) % items.length,
          );
          break;
        case "Home":
          if (items.length === 0) return;
          event.preventDefault();
          updateActive(0);
          break;
        case "End":
          if (items.length === 0) return;
          event.preventDefault();
          updateActive(items.length - 1);
          break;
        case "Enter":
          if (items.length === 0) return;
          if (mode === "slash" && isExactSlashInvocation(activeItem, input)) {
            // The command is already complete. Close the suggestion list but
            // leave this Enter unconsumed so ChatInput's normal bubble handler
            // can execute /model (and other exact commands) immediately.
            setDismissedTrigger({ input, inputRevision });
            return;
          }
          event.preventDefault();
          applyItem(active);
          break;
        case "Tab":
          if (items.length === 0) return;
          event.preventDefault();
          applyItem(active);
          break;
        case "Escape":
          event.preventDefault();
          setDismissedTrigger({ input, inputRevision });
          break;
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [
    active,
    activeItem,
    applyItem,
    cursor,
    input,
    inputRevision,
    items.length,
    inputRef,
    mode,
    rangeEnd,
    rangeStart,
    triggerKey,
    updateActive,
  ]);

  useSafeLayoutEffect(() => {
    if (!mode || rangeStart === null || rangeEnd === null) return;

    const updateLayout = () => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      // Anchor below the complete composer when there is no room above it,
      // so the menu does not cover the toolbar or Send control.
      const surface = anchor.closest('[data-ui="composer-shell"]') ?? anchor;
      const next = getPaletteLayout(
        surface.getBoundingClientRect(),
        mode === "slash" && items.length > 0,
      );
      setLayout((current) => (sameLayout(current, next) ? current : next));
    };

    let animationFrame: number | null = null;
    const scheduleLayout = () => {
      if (animationFrame !== null) return;
      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = null;
        updateLayout();
      });
    };

    updateLayout();
    window.addEventListener("resize", scheduleLayout);
    document.addEventListener("scroll", scheduleLayout, true);
    window.visualViewport?.addEventListener("resize", scheduleLayout);
    window.visualViewport?.addEventListener("scroll", scheduleLayout);
    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(scheduleLayout);
    if (anchorRef.current) resizeObserver?.observe(anchorRef.current);
    const surface = anchorRef.current?.closest('[data-ui="composer-shell"]');
    if (surface) resizeObserver?.observe(surface);

    return () => {
      window.removeEventListener("resize", scheduleLayout);
      document.removeEventListener("scroll", scheduleLayout, true);
      window.visualViewport?.removeEventListener("resize", scheduleLayout);
      window.visualViewport?.removeEventListener("scroll", scheduleLayout);
      if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame);
      }
      resizeObserver?.disconnect();
    };
  }, [items.length, mode, rangeEnd, rangeStart, triggerKey]);

  useSafeLayoutEffect(() => {
    if (detailsRef.current) detailsRef.current.scrollTop = 0;
  }, [activeOptionId]);

  useSafeLayoutEffect(() => {
    if (!activeOptionId) return;
    if (inspectTouchRef.current && layout?.compact) {
      revealInPanel(detailsRef.current, paletteRef.current);
    } else {
      const option = document.getElementById(activeOptionId);
      revealInPanel(option, listRef.current);
      revealInPanel(option, paletteRef.current);
    }
    inspectTouchRef.current = false;
  }, [activeOptionId, layout, selection]);

  if (!mode || rangeStart === null || rangeEnd === null) return null;

  const isSlash = mode === "slash";
  const paletteLabel = isSlash ? "Commands" : "Context";
  const resultLabel = `${items.length} ${items.length === 1 ? "result" : "results"}`;
  const activeArgumentHint =
    activeItem && optionalText(activeItem, "argumentHint");
  const activeCommand = activeItem?.command ?? `/${activeItem?.id}`;
  const palette = layout ? (
    <div
      ref={paletteRef}
      className={`pro-composer-palette ${styles.palette}`}
      data-compact={layout.compact || undefined}
      data-mode={mode}
      data-placement={layout.placement}
      data-testid="composer-palette"
      style={
        {
          bottom: layout.bottom,
          left: layout.left,
          top: layout.top,
          width: layout.width,
          maxHeight: layout.maxHeight,
        } satisfies CSSProperties
      }
    >
      <div className={layout.showHeader ? styles.header : "sr-only"}>
        <span className={styles.heading} id={`${paletteId}-label`}>
          {paletteLabel}
        </span>
        <span
          aria-live="polite"
          data-ui="composer-palette-result-count"
          className={styles.resultCount}
        >
          {resultLabel}
        </span>
      </div>

      <div
        ref={listRef}
        className={styles.scroll}
        data-ui="composer-palette-scroll"
        style={{ maxHeight: layout.listMaxHeight }}
      >
        <div
          aria-labelledby={`${paletteId}-label`}
          id={listboxId}
          role="listbox"
        >
          {groups.map((group, groupIndex) => {
            const groupLabelId = `${paletteId}-group-${groupIndex}`;
            return (
              <div
                aria-label={
                  isSlash
                    ? (group.label ?? paletteLabel)
                    : group.label
                      ? undefined
                      : paletteLabel
                }
                aria-labelledby={
                  !isSlash && group.label ? groupLabelId : undefined
                }
                key={`${group.label ?? "default"}-${groupIndex}`}
                role="group"
              >
                {!isSlash && group.label ? (
                  <div className={styles.groupHeading} id={groupLabelId}>
                    {group.label}
                  </div>
                ) : null}

                {group.entries.map(({ item, index }) => {
                  const Icon = item.icon;
                  const selected = index === active;
                  const argumentHint = optionalText(item, "argumentHint");
                  const shortcut = optionalText(item, "shortcut", "keybinding");
                  const category = optionalText(item, "category");
                  const showCategory = isSlash
                    ? category
                    : category && category !== group.label
                      ? category
                      : null;
                  const command =
                    item.command ?? `${isSlash ? "/" : "@"}${item.id}`;

                  return (
                    <button
                      aria-selected={selected}
                      aria-describedby={
                        selected && isSlash && layout.compact
                          ? `${paletteId}-selected-description`
                          : undefined
                      }
                      className={styles.option}
                      id={`${paletteId}-option-${item.id}-${index}`}
                      key={item.id}
                      onClick={(event) => {
                        const inspect =
                          isSlash &&
                          event.detail !== 0 &&
                          touchOptionRef.current === item.id;
                        touchOptionRef.current = null;
                        if (inspect) {
                          inspectTouchRef.current = true;
                          updateActive(index);
                        } else applyItem(index);
                      }}
                      onPointerDown={(event) => {
                        touchOptionRef.current =
                          event.pointerType === "touch" ? item.id : null;
                      }}
                      onPointerCancel={() => {
                        touchOptionRef.current = null;
                      }}
                      onFocus={() => updateActive(index)}
                      onMouseDown={(event) => event.preventDefault()}
                      onMouseEnter={() => updateActive(index)}
                      role="option"
                      tabIndex={-1}
                      type="button"
                      title={`${item.description}${argumentHint ? `\nUsage: ${command} ${argumentHint}` : ""}`}
                    >
                      <Icon
                        aria-hidden="true"
                        className={styles.icon}
                        strokeWidth={1.8}
                      />
                      <span className={styles.content}>
                        <span className={styles.titleRow}>
                          <span
                            data-ui="composer-palette-item-label"
                            className={styles.label}
                          >
                            {isSlash ? command : item.label}
                          </span>
                          {!isSlash ? (
                            <span className={styles.reference}>{command}</span>
                          ) : null}
                          {argumentHint ? (
                            <span className="sr-only">{argumentHint}</span>
                          ) : null}
                          {showCategory || shortcut ? (
                            <span className={styles.metadata}>
                              {showCategory ? (
                                <span className={styles.category}>
                                  {showCategory}
                                </span>
                              ) : null}
                              {shortcut ? (
                                <kbd className={styles.shortcut}>
                                  {shortcut}
                                </kbd>
                              ) : null}
                            </span>
                          ) : null}
                        </span>
                        <span
                          data-ui="composer-palette-item-description"
                          className={styles.description}
                        >
                          {item.description}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>

        {items.length === 0 ? (
          <div className={styles.empty} role="status">
            <p className={styles.label}>
              No matching {isSlash ? "commands" : "context sources"}
            </p>
            <p className={styles.description}>
              Try a different name or keyword.
            </p>
          </div>
        ) : null}
      </div>

      {isSlash && activeItem ? (
        <div
          ref={detailsRef}
          role="region"
          aria-label={`Help for ${activeCommand}`}
          aria-keyshortcuts="F1"
          tabIndex={0}
          className={styles.details}
          data-ui="composer-palette-details"
          style={{
            maxHeight: layout.compact ? undefined : layout.detailsMaxHeight,
          }}
          onKeyDown={(event) => {
            if (
              event.key !== "Escape" ||
              event.nativeEvent.isComposing ||
              event.keyCode === 229 ||
              event.shiftKey ||
              event.ctrlKey ||
              event.metaKey ||
              event.altKey
            )
              return;
            event.preventDefault();
            inputRef?.current?.focus({ preventScroll: true });
            const option = activeOptionId
              ? document.getElementById(activeOptionId)
              : null;
            revealInPanel(option, listRef.current);
            revealInPanel(option, paletteRef.current);
          }}
        >
          {layout.compact ? (
            <button
              type="button"
              className={styles.useCommand}
              onClick={() => {
                inputRef?.current?.focus({ preventScroll: true });
                const option = activeOptionId
                  ? document.getElementById(activeOptionId)
                  : null;
                revealInPanel(option, listRef.current);
                revealInPanel(option, paletteRef.current);
              }}
            >
              Back to commands
            </button>
          ) : null}
          <p
            id={`${paletteId}-selected-description`}
            data-ui="composer-palette-selected-description"
          >
            {activeItem.description}
          </p>
          <p className={styles.usage}>
            <span className={styles.usageLabel}>Usage</span>
            <code data-ui="composer-palette-selected-usage">
              {activeCommand}
              {activeArgumentHint ? ` ${activeArgumentHint}` : ""}
            </code>
          </p>
          <button
            type="button"
            className={styles.useCommand}
            onClick={() => applyItem(active)}
          >
            Use {activeCommand}
          </button>
        </div>
      ) : null}

      {layout.showFooter ? (
        <div aria-hidden="true" className={styles.footer}>
          {isSlash && activeItem ? (
            <span>F1 help</span>
          ) : activeArgumentHint ? (
            <span className={styles.argumentHint} title={activeArgumentHint}>
              {activeArgumentHint}
            </span>
          ) : (
            <span>↑↓ navigate</span>
          )}
          <span>↵ select</span>
          <span className={styles.dismiss}>esc close</span>
        </div>
      ) : null}
    </div>
  ) : null;

  return (
    <>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        data-ui="composer-palette-anchor"
        ref={anchorRef}
      />
      {palette && typeof document !== "undefined"
        ? createPortal(palette, document.body)
        : null}
    </>
  );
}
