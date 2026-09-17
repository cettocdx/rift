"use client";

import { useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Copy,
  ExternalLink,
  Globe,
  ListTree,
  PanelRight,
  RefreshCw,
  Rocket,
  Smartphone,
  Monitor,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useGlobalState } from "../contexts/GlobalState";
import { useBuildPreviewHealth } from "../hooks/useBuildPreviewHealth";
import { PreviewIdleGrid } from "./PreviewIdleGrid";
import { WorkbenchBrowser } from "./workbench/WorkbenchBrowser";

/** Live app preview with route history, device sizing and publication controls.
 * Desktop keeps a single compact toolbar. Phones separate navigation/address
 * from actions so 44px touch targets do not squeeze the editable address away.
 */
const ICON_BUTTON =
  "inline-flex size-11 md:size-6 shrink-0 items-center justify-center rounded-[6px] text-[var(--cursor-icon-secondary)] transition-colors duration-(--duration-hover) hover:bg-foreground/[0.06] hover:text-foreground focus-visible:outline-none focus-visible:bg-foreground/[0.06] disabled:pointer-events-none disabled:opacity-40";

export function BuildPreviewPanel({
  statusLine = null,
  building = false,
  onShowActivity,
  chatId,
  title,
  embedded = false,
  toolbarTarget,
  active = true,
}: {
  embedded?: boolean;
  toolbarTarget?: HTMLElement | null;
  active?: boolean;
  /** Live one-line activity headline while the run is still building. */
  statusLine?: string | null;
  /** True while the Build run is streaming and no preview URL exists yet. */
  building?: boolean;
  /**
   * Switch the pane back to Agent Activity. The preview and the activity panel
   * share one slot, so leaving the preview is a move between two surfaces, not
   * a close — without this the pane would just vanish whenever the sidebar
   * happened to be shut.
   */
  onShowActivity?: () => void;
  /** Chat the app belongs to; publishing records it against this run. */
  chatId?: string;
  /** Product name, used as the default address label. */
  title?: string;
}) {
  const { buildPreviewUrl, setBuildPreviewOpen } = useGlobalState();
  const health = useBuildPreviewHealth(chatId, buildPreviewUrl, active);
  const liveUrl =
    health.status === "running" || health.status === "unsupported"
      ? health.url
      : undefined;
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  // Bump to force the iframe to remount (hard reload of the embedded app).
  const [reloadKey, setReloadKey] = useState(0);

  /**
   * The preview's own address history.
   *
   * Back and Forward shipped permanently `disabled`, and they had to: the
   * preview is a cross-origin sandbox, so the parent cannot call history.back()
   * inside the frame — the browser forbids it. What the parent CAN own is the
   * path it puts in the frame, so this is a stack of the addresses this panel
   * navigated to. Typing a route in the bar pushes onto it; Back and Forward
   * walk it. That is a real browser control for the thing it can control,
   * rather than two grey buttons that never do anything.
   */
  const [history, setHistory] = useState<string[]>(["/"]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [addressDraft, setAddressDraft] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [publishedUrl, setPublishedUrl] = useState<string | null>(null);
  const [copyFallback, setCopyFallback] = useState<{
    chatId?: string;
    url: string;
  } | null>(null);
  const copyFieldRef = useRef<HTMLInputElement>(null);

  if (!buildPreviewUrl && !building) return null;

  const previewOrigin = (() => {
    if (!liveUrl) return null;
    try {
      return new URL(liveUrl).origin;
    } catch {
      return null;
    }
  })();

  const urlPath = history[historyIndex] ?? "/";
  const frameSrc =
    previewOrigin && urlPath !== "/" ? `${previewOrigin}${urlPath}` : liveUrl;

  const canGoBack = historyIndex > 0;
  const canGoForward = historyIndex < history.length - 1;

  const goTo = (rawPath: string) => {
    const trimmed = rawPath.trim();
    const path = trimmed.startsWith("/")
      ? trimmed
      : `/${trimmed.replace(/^https?:\/\/[^/]+/, "")}`;
    if (path === urlPath) return;
    setHistory((entries) => [...entries.slice(0, historyIndex + 1), path]);
    setHistoryIndex((index) => index + 1);
  };

  /**
   * Take the built app live at its own address.
   *
   * The preview URL belongs to a disposable sandbox, so this is not "share the
   * link" — the server snapshots the production build into storage and serves
   * it from a hostname that outlives the run.
   */
  const publish = async () => {
    if (!chatId || publishing || !liveUrl) return;
    setPublishing(true);
    try {
      const response = await fetch("/api/publish", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chatId, title }),
      });
      const result = (await response.json()) as {
        ok?: boolean;
        url?: string;
        error?: string;
        republished?: boolean;
      };
      if (!response.ok || !result.ok || !result.url) {
        toast.error(result.error ?? "Publishing failed.");
        return;
      }
      setPublishedUrl(result.url);
      toast.success(result.republished ? "Site updated" : "Site published", {
        description: result.url,
        action: {
          label: "Open",
          onClick: () => window.open(result.url, "_blank", "noopener"),
        },
      });
    } catch {
      toast.error("Publishing failed. Check your connection and try again.");
    } finally {
      setPublishing(false);
    }
  };

  const copyLink = async () => {
    if (!liveUrl) return;
    try {
      // Safari permissions and HTTP LAN origins may have no Clipboard API.
      // Await confirmation instead of announcing a copy that never happened.
      if (typeof navigator.clipboard?.writeText !== "function")
        throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(liveUrl);
      setCopyFallback(null);
      toast.success("Preview link copied");
    } catch {
      setCopyFallback({ chatId, url: liveUrl });
    }
  };

  const copyNotice =
    copyFallback &&
    copyFallback.chatId === chatId &&
    copyFallback.url === liveUrl ? (
      <div className="shrink-0 border-b border-border bg-muted/40 px-3 py-2">
        <p role="status" className="text-xs text-muted-foreground">
          Your browser couldn’t copy automatically. Select the link to copy it.
        </p>
        <div className="mt-1 flex items-center gap-2">
          <input
            ref={copyFieldRef}
            aria-label="Preview link"
            readOnly
            value={copyFallback.url}
            onFocus={(event) =>
              event.currentTarget.setSelectionRange(
                0,
                event.currentTarget.value.length,
              )
            }
            onClick={(event) =>
              event.currentTarget.setSelectionRange(
                0,
                event.currentTarget.value.length,
              )
            }
            className="h-11 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-base text-foreground md:text-sm"
          />
          <button
            type="button"
            onClick={() => {
              const field = copyFieldRef.current;
              if (!field) return;
              field.focus();
              field.setSelectionRange(0, field.value.length);
            }}
            aria-label="Select preview link"
            className="min-h-11 min-w-11 shrink-0 rounded-md px-2 text-sm text-foreground hover:bg-muted"
          >
            Select
          </button>
          <button
            type="button"
            aria-label="Dismiss copy link"
            onClick={() => setCopyFallback(null)}
            className="inline-flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X size={16} />
          </button>
        </div>
      </div>
    ) : null;

  const healthTitle =
    health.status === "checking"
      ? health.resuming
        ? "Resuming preview…"
        : "Checking preview…"
      : health.status === "stopped"
        ? "Preview stopped"
        : health.status === "paused"
          ? "Preview paused"
          : health.status === "transient"
            ? "Couldn’t check preview"
            : health.status === "stale"
              ? "Saved preview has changed"
              : "Preview unavailable";
  const healthMessage =
    health.status === "checking"
      ? health.resuming
        ? "Waking the existing environment and checking the app."
        : "Checking whether this saved preview is still running."
      : health.status === "transient"
        ? "The check timed out or could not connect. Try checking again."
        : health.status === "paused"
          ? "The preview environment is paused. Resume it to reopen this app."
          : health.status === "stopped"
            ? "The app server is stopped. Ask in this task to restart the preview."
            : "This saved link has no verified running preview. Ask in this task to start a preview from the available project files.";
  const unavailablePreview = buildPreviewUrl ? (
    <div
      className="flex h-full min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 text-center"
      role="status"
    >
      <p className="text-sm font-medium">{healthTitle}</p>
      <p className="max-w-sm text-sm text-muted-foreground">{healthMessage}</p>
      {health.status === "paused" && (
        <button
          type="button"
          onClick={health.resume}
          disabled={!active}
          className="min-h-11 rounded-md bg-foreground px-3 py-2 text-sm text-background disabled:opacity-40"
        >
          Resume preview
        </button>
      )}
      <button
        type="button"
        onClick={health.retry}
        disabled={!active || health.status === "checking"}
        className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted disabled:opacity-40"
      >
        Check again
      </button>
    </div>
  ) : (
    <PreviewIdleGrid statusLine={statusLine} />
  );

  const revalidationNotice = health.revalidationFailed ? (
    <div
      role="status"
      className="flex shrink-0 items-center gap-2 border-b border-border bg-muted/40 px-3 py-1 text-xs text-muted-foreground"
    >
      <p className="min-w-0 flex-1">
        Couldn’t recheck preview. Keeping your open preview.
      </p>
      <button
        type="button"
        onClick={health.retry}
        disabled={!active}
        className="min-h-11 shrink-0 rounded-md px-2 text-foreground hover:bg-muted disabled:opacity-40"
      >
        Check again
      </button>
    </div>
  ) : null;

  if (embedded)
    return (
      <div
        data-build-preview-panel
        className="flex h-full min-h-0 flex-col bg-background"
      >
        {revalidationNotice}
        {copyNotice}
        <div
          className="min-h-0 flex-1"
          style={
            device === "mobile"
              ? { width: "min(100%, 390px)", alignSelf: "center" }
              : undefined
          }
        >
          {liveUrl ? (
            <WorkbenchBrowser
              key={`${chatId}:${liveUrl}`}
              toolbarTarget={toolbarTarget}
              initialUrl={liveUrl}
              verifiedPreviewUrl={liveUrl}
              onReload={health.retry}
              active={active}
              toolbar={
                <>
                  <button
                    type="button"
                    className={ICON_BUTTON}
                    aria-label={
                      device === "desktop"
                        ? "Mobile preview"
                        : "Desktop preview"
                    }
                    title={
                      device === "desktop"
                        ? "Mobile preview"
                        : "Desktop preview"
                    }
                    onClick={() =>
                      setDevice(device === "desktop" ? "mobile" : "desktop")
                    }
                  >
                    {device === "desktop" ? (
                      <Smartphone size={14} />
                    ) : (
                      <Monitor size={14} />
                    )}
                  </button>
                  <button
                    type="button"
                    className={ICON_BUTTON}
                    aria-label="Copy preview link"
                    title="Copy link"
                    onClick={copyLink}
                  >
                    <Copy size={14} />
                  </button>
                </>
              }
            />
          ) : (
            unavailablePreview
          )}
        </div>
        <div className="flex min-h-8 items-center gap-3 border-t border-border/60 px-3 text-[11px] text-muted-foreground">
          <span className="min-w-0 flex-1 truncate">
            {liveUrl
              ? (statusLine ??
                (health.status === "running" && !health.revalidationFailed
                  ? "Preview running"
                  : "Preview"))
              : "Saved preview"}
          </span>
          <button
            type="button"
            disabled={!chatId || publishing || !liveUrl}
            onClick={() => void publish()}
            className="rounded px-2 py-1 text-foreground hover:bg-muted disabled:opacity-40"
          >
            {publishing
              ? "Publishing…"
              : publishedUrl
                ? "Publish update"
                : "Publish"}
          </button>
        </div>
      </div>
    );

  return (
    <div
      data-build-preview-panel
      /* Expanding fills the work area, not the viewport.
         It used to go `fixed inset-0 w-screen h-dvh`, which threw the panel
         over the whole window — sidebar included — while keeping the margin
         and the 22px corners it has as a docked pane. The result was a card
         floating on top of the app with its rounding cut off at the screen
         edges, and no navigation left to get back. Filling the pane's own
         container gives the preview every pixel the work area has and keeps
         the app around it. */
      className="top-0 left-0 desktop:top-auto desktop:left-auto desktop:right-auto z-50 fixed desktop:relative desktop:h-full h-full w-full flex-shrink-0"
    >
      {/* A pane, not a card. This was a rounded, shadowed, floating island
          with its own margin while the activity panel beside it sat flat
          against the window edge -- two different objects doing the same job.
          Same recipe as the activity panel now: flat, full-bleed, one hairline
          on the shared edge, the app's own background. */}
      <div className="flex h-full w-full flex-col overflow-hidden border-l border-border bg-background">
        {/* One row. It used to be two, and between them the device toggle, the
            reload and the close each appeared twice -- once as a button and
            again inside a three-item overflow menu whose only unique entry was
            Copy link -- so that one came out of the menu and onto the row, and
            the menu went away. Browsers put navigation, address and actions on
            one line; so does this. */}
        <div className="flex flex-col gap-1 border-b border-border/70 px-2 py-1.5 md:flex-row md:items-center">
          <div className="flex min-w-0 flex-1 items-center gap-1">
            <button
              type="button"
              onClick={() => setHistoryIndex((index) => Math.max(0, index - 1))}
              disabled={!canGoBack}
              aria-label="Back"
              className={ICON_BUTTON}
            >
              <ArrowLeft className="size-[15px]" strokeWidth={1.6} />
            </button>
            <button
              type="button"
              onClick={() => setHistoryIndex((index) => index + 1)}
              disabled={!canGoForward}
              aria-label="Forward"
              className={ICON_BUTTON}
            >
              <ArrowRight className="size-[15px]" strokeWidth={1.6} />
            </button>
            <button
              type="button"
              onClick={() => {
                setReloadKey((key) => key + 1);
                health.retry();
              }}
              disabled={!liveUrl}
              aria-label="Reload preview"
              className={ICON_BUTTON}
            >
              <RefreshCw className="size-[15px]" strokeWidth={1.6} />
            </button>

            {/* Editable, because a preview you cannot navigate is a screenshot.
              Type a route, press Enter, and the frame goes there. */}
            <form
              className="mx-1 min-w-0 flex-1"
              onSubmit={(event) => {
                event.preventDefault();
                goTo(addressDraft ?? urlPath);
                setAddressDraft(null);
              }}
            >
              <input
                type="text"
                autoCapitalize="none"
                autoCorrect="off"
                enterKeyHint="go"
                value={addressDraft ?? urlPath}
                onChange={(event) => setAddressDraft(event.target.value)}
                onBlur={() => setAddressDraft(null)}
                disabled={!liveUrl}
                aria-label="Preview address"
                spellCheck={false}
                className="w-full truncate rounded-lg bg-muted/40 px-3 py-1.5 font-mono text-base md:text-[12px] leading-5 text-muted-foreground outline-none transition-colors focus:text-foreground disabled:opacity-50"
                title={frameSrc ?? undefined}
              />
            </form>
          </div>
          <div className="flex shrink-0 items-center justify-end gap-1">
            {/* One control for one state. Two aria-pressed buttons for a boolean
              is two things to read where there is one thing to know. */}
            <button
              type="button"
              onClick={() =>
                setDevice((value) =>
                  value === "mobile" ? "desktop" : "mobile",
                )
              }
              aria-pressed={device === "mobile"}
              aria-label={
                device === "mobile"
                  ? "Switch to desktop width"
                  : "Switch to mobile width"
              }
              title={
                device === "mobile"
                  ? "Switch to desktop width"
                  : "Switch to mobile width"
              }
              className={`${ICON_BUTTON} ${device === "mobile" ? "bg-muted/40 text-foreground" : ""}`}
            >
              {device === "mobile" ? (
                <Smartphone className="size-[15px]" strokeWidth={1.6} />
              ) : (
                <Monitor className="size-[15px]" strokeWidth={1.6} />
              )}
            </button>
            <button
              type="button"
              onClick={copyLink}
              disabled={!liveUrl}
              aria-label="Copy preview link"
              title="Copy preview link"
              className={ICON_BUTTON}
            >
              <Copy className="size-[15px]" strokeWidth={1.6} />
            </button>
            <a
              href={frameSrc ?? undefined}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Open in new tab"
              aria-disabled={!liveUrl}
              className={`${ICON_BUTTON} ${!liveUrl ? "pointer-events-none opacity-40" : ""}`}
            >
              <ExternalLink className="size-[15px]" strokeWidth={1.6} />
            </a>

            {publishedUrl ? (
              <a
                href={publishedUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-1 inline-flex h-11 md:h-6 max-w-[180px] items-center gap-1 truncate rounded-full border border-border bg-muted/40 px-2.5 text-[11.5px] font-medium text-foreground transition-colors hover:bg-muted/60 focus-visible:outline-none"
              >
                <Globe className="size-3 shrink-0" />
                <span className="truncate">
                  {publishedUrl.replace(/^https?:\/\//, "")}
                </span>
              </a>
            ) : (
              <button
                type="button"
                onClick={publish}
                disabled={!liveUrl || !chatId || publishing}
                className="ml-1 inline-flex h-11 md:h-6 items-center gap-1 rounded-full bg-foreground px-2.5 text-[11.5px] font-medium text-background transition-colors hover:bg-foreground/90 focus-visible:outline-none active:translate-y-px disabled:pointer-events-none disabled:opacity-40 motion-reduce:transition-none"
              >
                <Rocket className="size-3" />
                {publishing ? "Publishing…" : "Publish"}
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                if (onShowActivity) {
                  onShowActivity();
                  return;
                }
                setBuildPreviewOpen(false);
              }}
              aria-label={
                onShowActivity ? "Show agent activity" : "Close preview"
              }
              className={ICON_BUTTON}
            >
              {onShowActivity ? (
                <ListTree className="size-[15px]" strokeWidth={1.6} />
              ) : (
                <PanelRight className="size-[15px]" strokeWidth={1.6} />
              )}
            </button>
          </div>
        </div>

        {revalidationNotice}
        {copyNotice}
        {/* Body — building grid until the app exists, then the app itself */}
        {liveUrl ? (
          <div className="flex min-h-0 flex-1 justify-center overflow-hidden bg-[#0a0a0a]">
            <iframe
              key={`${reloadKey}:${urlPath}`}
              src={frameSrc ?? undefined}
              title="App preview"
              className={`h-full bg-white transition-[max-width] motion-reduce:transition-none ${
                device === "mobile" ? "w-full max-w-[390px]" : "w-full"
              }`}
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
            />
          </div>
        ) : (
          unavailablePreview
        )}
      </div>
    </div>
  );
}
