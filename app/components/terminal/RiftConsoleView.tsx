"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { ArrowDown, ChevronRight, SquareTerminal } from "lucide-react";
import { CursorActivityGlyph } from "@/components/ui/cursor-thinking";
import { RiftTerminalArt } from "./RiftTerminalArt";
import {
  CONSOLE_MAX_INPUT_LENGTH,
  type ConsoleChoice,
  type ConsoleCommand,
  type ConsoleEntry,
  type ConsoleSnapshot,
} from "@/packages/console/src/protocol";
import styles from "./RiftConsoleView.module.css";

export type RiftConsoleViewProps = {
  snapshot: ConsoleSnapshot;
  onCommand: (
    command: ConsoleCommand,
  ) => Promise<{ accepted: boolean; error?: string }>;
  onOpenApp?: () => void;
};

type SettingsMenu = "model" | "effort" | "permissions" | "mode" | "target";
type Menu = SettingsMenu | "commands";
type CommandName = SettingsMenu | "new" | "stop" | "help";
type PaletteItem = {
  value: string;
  label: string;
  description?: string;
  current?: boolean;
  disabled?: boolean;
};

const COMMANDS: { name: CommandName; description: string }[] = [
  { name: "model", description: "Choose a model" },
  { name: "effort", description: "Set reasoning effort" },
  { name: "permissions", description: "Choose how actions are approved" },
  { name: "mode", description: "Choose a working mode" },
  { name: "target", description: "Choose where work runs" },
  { name: "new", description: "Start a new chat" },
  { name: "stop", description: "Stop the current run" },
  { name: "help", description: "Show console commands" },
];

const MENU_TITLES: Record<Menu, string> = {
  commands: "Commands",
  model: "Model",
  effort: "Reasoning effort",
  permissions: "Action permissions",
  mode: "Working mode",
  target: "Run on",
};

const SETTING_COMMANDS: Record<
  SettingsMenu,
  "set-model" | "set-effort" | "set-approval" | "set-mode" | "set-target"
> = {
  model: "set-model",
  effort: "set-effort",
  permissions: "set-approval",
  mode: "set-mode",
  target: "set-target",
};

function settingsMenu(value: string): value is SettingsMenu {
  return Object.hasOwn(SETTING_COMMANDS, value);
}

function choiceLabel(choices: ConsoleChoice[], value: string) {
  return choices.find((choice) => choice.value === value)?.label ?? value;
}

function ActivityEntry({ entry }: { entry: ConsoleEntry }) {
  const [summary, ...body] = entry.text.split("\n");
  const detail = body.join("\n").trim();
  if (!detail) {
    return (
      <div className={styles.activity}>
        <div className={styles.activitySummary} data-interactive="false">
          <span aria-hidden className={styles.promptGlyph}>
            ·
          </span>
          <span className={styles.activityLabel}>{summary}</span>
        </div>
      </div>
    );
  }
  return (
    <details className={styles.activity}>
      <summary className={styles.activitySummary}>
        <ChevronRight aria-hidden />
        <span className={styles.activityLabel}>{summary}</span>
      </summary>
      <div className={styles.activityDetail}>{detail}</div>
    </details>
  );
}

export function RiftConsoleView({
  snapshot,
  onCommand,
  onOpenApp,
}: RiftConsoleViewProps) {
  const paletteId = useId();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const paletteRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);
  const pendingRef = useRef(false);
  const historyRef = useRef<string[]>([]);
  const historyIndexRef = useRef<number | null>(null);
  const savedDraftRef = useRef("");
  const [draft, setDraft] = useState("");
  const [explicitMenu, setExplicitMenu] = useState<Menu | null>(null);
  const [dismissedDraft, setDismissedDraft] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [showLatest, setShowLatest] = useState(false);
  const busy =
    snapshot.status === "submitted" || snapshot.status === "streaming";
  const unavailable = snapshot.status === "unavailable";

  const choices = useMemo<Record<SettingsMenu, ConsoleChoice[]>>(
    () => ({
      model: snapshot.models,
      effort: snapshot.efforts,
      permissions: snapshot.permissions ?? [],
      mode: snapshot.modes ?? [],
      target: snapshot.targets,
    }),
    [
      snapshot.models,
      snapshot.efforts,
      snapshot.permissions,
      snapshot.modes,
      snapshot.targets,
    ],
  );
  const current = {
    model: snapshot.model,
    effort: snapshot.effort,
    permissions: snapshot.approval,
    mode: snapshot.mode,
    target: snapshot.target,
  };

  const slash = draft.match(/^\/([\w-]*)(?:[ \t]+([^\n]*))?$/);
  const slashSetting = slash && settingsMenu(slash[1]) ? slash[1] : null;
  const menu: Menu | null =
    explicitMenu ??
    (slash && dismissedDraft !== draft
      ? slashSetting && /\s/.test(draft)
        ? slashSetting
        : "commands"
      : null);
  const filter = explicitMenu
    ? ""
    : menu === "commands"
      ? (slash?.[1] ?? "")
      : (slash?.[2] ?? "");
  const lowerFilter = filter.toLocaleLowerCase();
  const items: PaletteItem[] = menu
    ? menu === "commands"
      ? COMMANDS.filter(({ name }) => name.includes(lowerFilter)).map(
          ({ name, description }) => ({
            value: name,
            label: `/${name}`,
            description,
            disabled:
              name === "stop"
                ? !busy
                : settingsMenu(name)
                  ? choices[name].length === 0
                  : false,
          }),
        )
      : choices[menu]
          .filter((choice) =>
            `${choice.label} ${choice.value}`
              .toLocaleLowerCase()
              .includes(lowerFilter),
          )
          .map((choice) => ({
            ...choice,
            current: choice.value === current[menu],
          }))
    : [];
  const menuKey = `${menu}:${filter}:${items.map((item) => item.value).join(",")}`;
  const activeItem = items[activeIndex];
  const initialActiveIndex =
    menu !== "commands" && !filter
      ? Math.max(
          0,
          items.findIndex((item) => item.current),
        )
      : 0;

  useEffect(() => {
    setActiveIndex(initialActiveIndex);
  }, [menuKey, initialActiveIndex]);

  useEffect(() => {
    const selected = paletteRef.current?.querySelector<HTMLElement>(
      '[aria-selected="true"]',
    );
    if (!selected) return;
    const parent = paletteRef.current;
    if (!parent) return;
    const top = selected.offsetTop - parent.offsetTop;
    if (top < parent.scrollTop) parent.scrollTop = top;
    else if (
      top + selected.offsetHeight >
      parent.scrollTop + parent.clientHeight
    )
      parent.scrollTop = top + selected.offsetHeight - parent.clientHeight;
  }, [activeIndex, menuKey]);

  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    // Empty input has a known single-line height. Reading scrollHeight here
    // otherwise forces the freshly mounted terminal to lay out before paint.
    if (!draft) {
      input.style.height = "20px";
      return;
    }
    input.style.height = "auto";
    input.style.height = `${Math.min(180, Math.max(20, input.scrollHeight))}px`;
  }, [draft]);

  const entriesKey = snapshot.entries
    .map((entry) => `${entry.id}:${entry.text.length}`)
    .join("|");
  const hasEntries = snapshot.entries.length > 0;
  useLayoutEffect(() => {
    atBottomRef.current = true;
    setShowLatest(false);
    const viewport = transcriptRef.current;
    // The welcome is a page to read from the top, not streamed output.
    if (viewport) viewport.scrollTop = hasEntries ? viewport.scrollHeight : 0;
  }, [snapshot.chatId, hasEntries]);

  useLayoutEffect(() => {
    const viewport = transcriptRef.current;
    if (!viewport || !hasEntries) return;
    if (atBottomRef.current) viewport.scrollTop = viewport.scrollHeight;
    else setShowLatest(true);
  }, [entriesKey, hasEntries]);

  useEffect(() => {
    const viewport = transcriptRef.current;
    if (!viewport || !hasEntries || typeof ResizeObserver === "undefined")
      return;
    const observer = new ResizeObserver(() => {
      if (atBottomRef.current) viewport.scrollTop = viewport.scrollHeight;
    });
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [hasEntries]);

  const closeMenu = useCallback(() => {
    setExplicitMenu(null);
    setDismissedDraft(draft);
  }, [draft]);

  useEffect(() => {
    if (!menu) return;
    const dismissOutside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !bottomRef.current?.contains(event.target)
      ) {
        closeMenu();
      }
    };
    document.addEventListener("pointerdown", dismissOutside);
    return () => document.removeEventListener("pointerdown", dismissOutside);
  }, [menu, closeMenu]);

  const openMenu = (next: Menu) => {
    setExplicitMenu(next);
    setActiveIndex(
      next === "commands"
        ? 0
        : Math.max(
            0,
            choices[next].findIndex((choice) => choice.value === current[next]),
          ),
    );
    setFeedback(null);
    inputRef.current?.focus();
  };

  const dispatch = async (
    command: ConsoleCommand,
    clearMatchingDraft?: string,
  ) => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setFeedback(null);
    try {
      const result = await onCommand(command);
      if (!result.accepted) {
        setFeedback(
          result.error || "That action could not be completed. Try again.",
        );
        return;
      }
      if (command.type === "submit") {
        const previous = historyRef.current.at(-1);
        if (previous !== command.text) {
          historyRef.current = [...historyRef.current.slice(-49), command.text];
        }
        historyIndexRef.current = null;
        savedDraftRef.current = "";
      }
      if (clearMatchingDraft !== undefined) {
        setDraft((value) => (value === clearMatchingDraft ? "" : value));
      }
      setExplicitMenu(null);
      setDismissedDraft(clearMatchingDraft === undefined ? draft : null);
    } catch (error) {
      setFeedback(
        error instanceof Error
          ? error.message
          : "The console could not complete that action.",
      );
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  };

  const runNamedCommand = (name: string) => {
    if (settingsMenu(name)) {
      if (explicitMenu) openMenu(name);
      else {
        setDraft(`/${name} `);
        setDismissedDraft(null);
      }
      return;
    }
    if (name === "help") {
      if (!explicitMenu && slash) setDraft("");
      openMenu("commands");
    } else if (name === "new") {
      void dispatch({ type: "new-chat" }, slash ? draft : undefined);
    } else if (name === "stop") {
      if (busy) {
        void dispatch(
          { type: "stop", chatId: snapshot.chatId },
          slash ? draft : undefined,
        );
      } else setFeedback("There is no active run to stop.");
    } else
      setFeedback("Unknown command. Type /help to see available commands.");
  };

  const chooseItem = (item: PaletteItem) => {
    if (!menu || item.disabled || pending) return;
    if (menu === "commands") runNamedCommand(item.value);
    else {
      void dispatch(
        { type: SETTING_COMMANDS[menu], value: item.value },
        slashSetting === menu ? draft : undefined,
      );
    }
  };

  const submit = () => {
    if (pending || unavailable || !draft.trim()) return;
    if (slash) {
      if (settingsMenu(slash[1])) {
        openMenu(slash[1]);
      } else runNamedCommand(slash[1]);
      return;
    }
    void dispatch(
      { type: "submit", text: draft.trim(), chatId: snapshot.chatId },
      draft,
    );
  };

  const inputKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (menu) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex((index) => {
          if (!items.length) return 0;
          return (
            (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) %
            items.length
          );
        });
        return;
      }
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        if (activeItem) chooseItem(activeItem);
        else if (menu === "commands") {
          setFeedback("Unknown command. Type /help to see available commands.");
        }
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
      return;
    }
    const input = event.currentTarget;
    if (
      event.key === "ArrowUp" &&
      input.selectionStart === 0 &&
      historyRef.current.length
    ) {
      event.preventDefault();
      if (historyIndexRef.current === null) {
        savedDraftRef.current = draft;
        historyIndexRef.current = historyRef.current.length - 1;
      } else historyIndexRef.current = Math.max(0, historyIndexRef.current - 1);
      setDraft(historyRef.current[historyIndexRef.current]);
    } else if (
      event.key === "ArrowDown" &&
      input.selectionEnd === draft.length &&
      historyIndexRef.current !== null
    ) {
      event.preventDefault();
      if (historyIndexRef.current < historyRef.current.length - 1) {
        historyIndexRef.current += 1;
        setDraft(historyRef.current[historyIndexRef.current]);
      } else {
        historyIndexRef.current = null;
        setDraft(savedDraftRef.current);
      }
    }
  };

  const jumpToLatest = () => {
    const viewport = transcriptRef.current;
    if (viewport) viewport.scrollTop = viewport.scrollHeight;
    atBottomRef.current = true;
    setShowLatest(false);
  };

  const statusLabel = unavailable
    ? "Console unavailable"
    : snapshot.approvals.length
      ? "Waiting for your approval"
      : snapshot.status === "submitted"
        ? "Starting…"
        : snapshot.status === "streaming"
          ? "Working…"
          : snapshot.status === "error"
            ? "Run interrupted"
            : "Ready";

  return (
    <section
      aria-label="RIFT console"
      className={styles.console}
      data-theme="dark"
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.nativeEvent.isComposing) return;
        if (menu) {
          event.preventDefault();
          event.stopPropagation();
          closeMenu();
          inputRef.current?.focus();
        } else if (busy && !pending) {
          event.preventDefault();
          event.stopPropagation();
          void dispatch({ type: "stop", chatId: snapshot.chatId });
        }
      }}
    >
      <div className={styles.titlebar}>
        <SquareTerminal size={14} aria-hidden />
        <span>RIFT Terminal</span>
      </div>
      <header className={styles.header}>
        <span className={styles.location} title={snapshot.targetLabel}>
          {snapshot.targetLabel}
        </span>
        {snapshot.mode ? (
          <span
            className={styles.sessionTitle}
            title={snapshot.chatId ?? undefined}
          >
            {choiceLabel(choices.mode, snapshot.mode)}
          </span>
        ) : null}
      </header>

      <div
        ref={transcriptRef}
        className={styles.transcript}
        aria-label="Console transcript"
        tabIndex={0}
        onScroll={(event) => {
          const viewport = event.currentTarget;
          atBottomRef.current =
            viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <
            48;
          setShowLatest(!atBottomRef.current);
        }}
      >
        {snapshot.entries.length === 0 ? (
          <div className={styles.welcome}>
            <RiftTerminalArt />
            <div>
              <h2 className={styles.brandName}>RIFT Build</h2>
              <p className={styles.tagline}>
                Recursive Intelligence for Technology
              </p>
              <div className={styles.welcomeActions}>
                <button
                  type="button"
                  className={styles.welcomeAction}
                  disabled={pending}
                  onClick={() => void dispatch({ type: "new-chat" })}
                >
                  <span>New chat</span>
                  <span>/new</span>
                </button>
                <button
                  type="button"
                  className={styles.welcomeAction}
                  disabled={!choices.model.length}
                  onClick={() => openMenu("model")}
                >
                  <span>Select model</span>
                  <span>/model</span>
                </button>
                <button
                  type="button"
                  className={styles.welcomeAction}
                  onClick={() => openMenu("commands")}
                >
                  <span>Commands</span>
                  <span>/help</span>
                </button>
              </div>
            </div>
          </div>
        ) : (
          snapshot.entries.map((entry) => {
            if (entry.kind === "activity")
              return <ActivityEntry key={entry.id} entry={entry} />;
            return (
              <div
                key={entry.id}
                className={
                  entry.kind === "user" ? styles.userEntry : styles.entry
                }
                data-kind={entry.kind}
              >
                {entry.kind === "user" ? (
                  <span aria-hidden className={styles.promptGlyph}>
                    ❯
                  </span>
                ) : null}
                <div className={styles.entryBody}>{entry.text}</div>
              </div>
            );
          })
        )}

        {snapshot.approvals.map((approval) => (
          <div key={approval.id} className={styles.approval}>
            <div className={styles.approvalTitle}>
              Review {approval.toolName}
            </div>
            <pre className={styles.approvalPreview}>{approval.preview}</pre>
            <div className={styles.approvalActions}>
              <button
                type="button"
                disabled={pending || !snapshot.chatId}
                onClick={() =>
                  snapshot.chatId &&
                  void dispatch({
                    type: "approve",
                    id: approval.id,
                    approve: false,
                    chatId: snapshot.chatId,
                  })
                }
              >
                Decline
              </button>
              <button
                type="button"
                disabled={pending || !snapshot.chatId}
                onClick={() =>
                  snapshot.chatId &&
                  void dispatch({
                    type: "approve",
                    id: approval.id,
                    approve: true,
                    chatId: snapshot.chatId,
                  })
                }
              >
                Approve
              </button>
            </div>
          </div>
        ))}
      </div>

      <div ref={bottomRef} className={styles.bottom}>
        {showLatest ? (
          <button
            type="button"
            className={styles.latest}
            onClick={jumpToLatest}
          >
            <ArrowDown aria-hidden />
            Latest
          </button>
        ) : null}
        <div className={styles.runStatus}>
          <span role="status" className={styles.runLabel}>
            {busy && !unavailable && snapshot.approvals.length === 0 ? (
              <CursorActivityGlyph active />
            ) : null}
            {statusLabel}
            {snapshot.queued > 0 ? ` · ${snapshot.queued} queued` : ""}
          </span>
          {busy ? (
            <button
              type="button"
              className={styles.textButton}
              disabled={pending}
              onClick={() =>
                void dispatch({ type: "stop", chatId: snapshot.chatId })
              }
            >
              [stop]
            </button>
          ) : null}
        </div>
        {feedback ? (
          <p role="alert" className={styles.feedback}>
            {feedback}
          </p>
        ) : null}
        {unavailable ? (
          <div className={styles.unavailable}>
            <span>
              {snapshot.target === "native"
                ? "Use the workspace controls above to connect."
                : "Open Build to connect this console."}
            </span>
            {onOpenApp ? (
              <button
                type="button"
                className={styles.textButton}
                onClick={onOpenApp}
              >
                Open Build
              </button>
            ) : null}
          </div>
        ) : null}

        {menu ? (
          <div className={styles.palette} data-menu={menu}>
            <div className={styles.paletteHeader}>
              <span>{MENU_TITLES[menu]}</span>
              <span>{items.length}</span>
            </div>
            <div
              ref={paletteRef}
              id={paletteId}
              role="listbox"
              aria-label={MENU_TITLES[menu]}
              className={styles.paletteList}
            >
              {items.length ? (
                items.map((item, index) => (
                  <button
                    id={`${paletteId}-${index}`}
                    key={item.value}
                    type="button"
                    role="option"
                    aria-selected={index === activeIndex}
                    aria-disabled={item.disabled || pending}
                    className={styles.option}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseMove={() => setActiveIndex(index)}
                    onClick={() => chooseItem(item)}
                    title={item.description}
                  >
                    <span aria-hidden>{index === activeIndex ? "❯" : ""}</span>
                    <span className={styles.optionName}>
                      {item.label}
                      {item.current ? " ✓" : ""}
                    </span>
                    <span className={styles.optionDescription}>
                      {item.description || (item.current ? "Current" : "")}
                    </span>
                  </button>
                ))
              ) : (
                <p className={styles.emptyPalette}>No matching options.</p>
              )}
            </div>
          </div>
        ) : null}

        <div className={styles.composer}>
          <span aria-hidden className={styles.promptGlyph}>
            ❯
          </span>
          <textarea
            ref={inputRef}
            role="combobox"
            aria-label="Message RIFT console"
            aria-autocomplete="list"
            aria-expanded={Boolean(menu)}
            aria-controls={menu ? paletteId : undefined}
            aria-activedescendant={
              menu && activeItem ? `${paletteId}-${activeIndex}` : undefined
            }
            className={styles.input}
            value={draft}
            rows={1}
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            maxLength={CONSOLE_MAX_INPUT_LENGTH}
            placeholder={
              unavailable
                ? snapshot.target === "native"
                  ? "Connect a workspace"
                  : "Connect through Build"
                : busy
                  ? "Add a follow-up…"
                  : "Build something…"
            }
            disabled={unavailable}
            onChange={(event) => {
              setDraft(event.target.value);
              setExplicitMenu(null);
              setDismissedDraft(null);
              historyIndexRef.current = null;
              setFeedback(null);
            }}
            onKeyDown={inputKeyDown}
          />
          <div className={styles.caption}>
            <button
              type="button"
              className={styles.captionModel}
              aria-label={`Select model: ${snapshot.modelLabel}`}
              aria-expanded={menu === "model"}
              disabled={!choices.model.length}
              onClick={() => openMenu("model")}
              title={snapshot.modelLabel}
            >
              {snapshot.modelLabel}
            </button>
            {snapshot.effort ? (
              <button
                type="button"
                aria-label={`Select effort: ${choiceLabel(choices.effort, snapshot.effort)}`}
                aria-expanded={menu === "effort"}
                disabled={!choices.effort.length}
                onClick={() => openMenu("effort")}
              >
                ({choiceLabel(choices.effort, snapshot.effort)})
              </button>
            ) : null}
            {snapshot.approval ? (
              <>
                <span aria-hidden className={styles.captionSeparator}>
                  ·
                </span>
                <button
                  type="button"
                  aria-label={`Select permissions: ${choiceLabel(choices.permissions, snapshot.approval)}`}
                  aria-expanded={menu === "permissions"}
                  disabled={!choices.permissions.length}
                  onClick={() => openMenu("permissions")}
                >
                  {choiceLabel(choices.permissions, snapshot.approval)}
                </button>
              </>
            ) : null}
          </div>
        </div>
        <div className={styles.hints}>
          <span>
            <kbd>Enter</kbd> {busy ? "queue" : "send"}
          </span>
          <span className={styles.optionalHint}>
            <kbd>Shift Enter</kbd> new line
          </span>
          {busy ? (
            <span>
              <kbd>Esc</kbd> stop
            </span>
          ) : null}
          <button
            type="button"
            className={styles.hintHelp}
            onClick={() => openMenu("commands")}
          >
            / commands
          </button>
        </div>
      </div>
    </section>
  );
}
