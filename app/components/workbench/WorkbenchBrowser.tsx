"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Globe,
  RotateCw,
  Ellipsis,
  X,
} from "lucide-react";
import { createPortal } from "react-dom";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { v4 as uuid } from "uuid";
import { isTauriEnvironment, openInBrowser } from "@/app/hooks/useTauri";
import { normalizeBrowserAddress } from "@/lib/workbench/browser-url";
import styles from "./WorkbenchDock.module.css";

type Snapshot = {
  tabId: string;
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
};
type NativeSession = {
  tabId: string;
  closed: boolean;
  created: boolean;
  visible: boolean;
  revision: number;
  visibilityRevision: number;
  pendingLocation?: { previous: string; target?: string };
};

// Views share the native window. Serializing all mutations prevents a late
// hide/close from overtaking another tab's show, including StrictMode remounts.
let nativeCommands: Promise<unknown> = Promise.resolve();
let nativeVisibilityRevision = 0;
let nativeViewsHidden = true;
function queueNative<T>(operation: () => Promise<T>): Promise<T> {
  const result = nativeCommands.then(operation);
  nativeCommands = result.catch(() => {});
  return result;
}
async function native<T>(command: string, args: Record<string, unknown>) {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, args);
}
async function hideAll() {
  await native("browser_tabs_hide_all", {});
  nativeVisibilityRevision += 1;
  nativeViewsHidden = true;
}
const OVERLAY_SELECTOR =
  '[role="dialog"], [role="alertdialog"], [role="menu"], [data-slot="popover-content"], dialog[open], [data-rift-dock-resizing="true"]';
function hasOverlay() {
  return Array.from(
    document.querySelectorAll<HTMLElement>(OVERLAY_SELECTOR),
  ).some(
    (element) =>
      !element.closest('[hidden], [inert], [data-state="closed"]') &&
      getComputedStyle(element).display !== "none" &&
      getComputedStyle(element).visibility !== "hidden",
  );
}

// Streaming elsewhere in the conversation changes thousands of DOM nodes.
// Only native-view ancestors and overlay changes need an immediate layout
// check. ResizeObserver and the position safety check cover ordinary geometry.
function affectsNativeView(record: MutationRecord, viewport: HTMLElement) {
  const relevant = (node: Node) =>
    node instanceof Element &&
    (node.contains(viewport) ||
      node.matches(OVERLAY_SELECTOR) ||
      node.querySelector(OVERLAY_SELECTOR) !== null);
  if (record.type === "attributes") {
    // Include removed roles/slots, which no longer match the selector.
    return (
      record.attributeName === "role" ||
      record.attributeName === "data-slot" ||
      relevant(record.target)
    );
  }
  return (
    Array.from(record.addedNodes).some(relevant) ||
    Array.from(record.removedNodes).some(relevant)
  );
}

function sameSnapshot(a: Snapshot | null, b: Snapshot) {
  return (
    a?.tabId === b.tabId &&
    a.url === b.url &&
    a.title === b.title &&
    a.loading === b.loading &&
    a.canGoBack === b.canGoBack &&
    a.canGoForward === b.canGoForward
  );
}

export function WorkbenchBrowser({
  initialUrl,
  active,
  onTitleChange,
  toolbar,
  toolbarTarget,
  verifiedPreviewUrl,
  onReload,
}: {
  initialUrl?: string;
  active: boolean;
  onTitleChange?: (title: string) => void;
  toolbar?: ReactNode;
  /** Dock-owned host: move chrome without remounting the browser view. */
  toolbarTarget?: HTMLElement | null;
  /** Health-verified app endpoint; ordinary browser tabs remain opaque-origin. */
  verifiedPreviewUrl?: string;
  /** Refresh the owning preview's health alongside an explicit browser reload. */
  onReload?: () => void;
}) {
  const [url, setUrl] = useState(() =>
    initialUrl ? (normalizeBrowserAddress(initialUrl) ?? "") : "",
  );
  const [draft, setDraft] = useState(url);
  const [editing, setEditing] = useState(false);
  const [nativeId, setNativeId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [desktop, setDesktop] = useState(false);
  const [loading, setLoading] = useState(false);
  const [frameKey, setFrameKey] = useState(0);
  const [history, setHistory] = useState(() => (url ? [url] : []));
  const [index, setIndex] = useState(url ? 0 : -1);
  const viewport = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<NativeSession | null>(null);
  const mounted = useRef(false);
  const currentUrl = useRef(url);
  currentUrl.current = url;
  const currentActive = useRef(active);
  currentActive.current = active;
  const latestSnapshot = useRef<Snapshot | null>(null);
  const publishedTitle = useRef("");
  const titleCallback = useRef(onTitleChange);
  titleCallback.current = onTitleChange;
  const updateLayout = useRef(() => {});
  const preservesPreviewOrigin = (() => {
    if (!verifiedPreviewUrl || typeof window === "undefined") return false;
    try {
      const target = new URL(url);
      const verified = new URL(verifiedPreviewUrl);
      return (
        ["http:", "https:"].includes(target.protocol) &&
        target.origin === verified.origin &&
        target.origin !== window.location.origin
      );
    } catch {
      return false;
    }
  })();

  const isCurrent = (session: NativeSession) =>
    !session.closed && sessionRef.current === session;
  const applySnapshot = (session: NativeSession, state: Snapshot) => {
    if (!isCurrent(session) || state.tabId !== session.tabId) return;
    latestSnapshot.current = state;
    setSnapshot((previous) =>
      sameSnapshot(previous, state) ? previous : state,
    );
    const observedUrl = normalizeBrowserAddress(state.url);
    // WKWebView can report the previous URL just after navigate() returns.
    // Keep the user's requested address until a different URL is observed.
    const pending = session.pendingLocation;
    if (
      pending &&
      observedUrl === pending.previous &&
      observedUrl !== pending.target
    )
      return;
    session.pendingLocation = undefined;
    if (observedUrl) {
      currentUrl.current = observedUrl;
      setUrl(observedUrl);
    }
    if (state.title && state.title !== publishedTitle.current) {
      publishedTitle.current = state.title;
      titleCallback.current?.(state.title);
    }
  };

  useEffect(() => {
    mounted.current = true;
    if (!isTauriEnvironment())
      return () => {
        mounted.current = false;
      };
    setDesktop(true);
    const session: NativeSession = {
      tabId: uuid(),
      closed: false,
      created: false,
      visible: false,
      revision: 0,
      visibilityRevision: 0,
    };
    sessionRef.current = session;
    const requested = currentUrl.current || "about:blank";
    void queueNative(async () => {
      if (!isCurrent(session)) return;
      const state = await native<Snapshot>("browser_tab_create", {
        tabId: session.tabId,
        url: requested,
      });
      session.created = true;
      if (!isCurrent(session)) return;
      setNativeId(session.tabId);
      if (session.revision === 0) {
        // Blank new tabs keep their empty-state address field.
        if (requested === "about:blank" && !currentUrl.current) {
          latestSnapshot.current = state;
          setSnapshot(state);
        } else applySnapshot(session, state);
      }
    }).catch(() => {
      if (!isCurrent(session)) return;
      // macOS keeps the native view when creation succeeds. Unsupported/older
      // shells use the same isolated iframe fallback as the web application.
      session.closed = true;
      sessionRef.current = null;
      setDesktop(false);
      setNativeId(null);
      const fallbackUrl = currentUrl.current;
      setHistory(fallbackUrl ? [fallbackUrl] : []);
      setIndex(fallbackUrl ? 0 : -1);
      setError(
        "Native browsing is unavailable. Showing a web preview; some sites require opening externally.",
      );
    });
    return () => {
      mounted.current = false;
      session.closed = true;
      session.visibilityRevision += 1;
      if (sessionRef.current === session) sessionRef.current = null;
      void queueNative(async () => {
        try {
          await hideAll();
        } finally {
          await native("browser_tab_close", { tabId: session.tabId });
        }
      }).catch(() => {});
    };
    // This setup owns one native generation, not each changing URL/callback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const session = sessionRef.current;
    const element = viewport.current;
    if (!nativeId || !session || !element) return;
    let disposed = false;
    let last = "";
    let scaleFactor = window.devicePixelRatio || 1;
    let layoutRevision = 0;
    let raf = 0;
    // Desired visibility is not an acknowledgement from the native view. A
    // rejected hide must remain eligible for retry after this tab is inactive.
    let nativeMayBeVisible = false;
    let retryHideAt = 0;
    const visibility = () =>
      currentActive.current &&
      !!currentUrl.current &&
      !document.hidden &&
      !hasOverlay() &&
      !element.closest("[hidden], [inert]");
    const layout = () => {
      if (disposed || !isCurrent(session)) return;
      // A retained, already-hidden tab has no geometry to publish. Streaming
      // in another panel must not force layout reads for every inactive tab.
      // A visible tab still runs once to hide; reactivation runs synchronously
      // through updateLayout in the layout effect below.
      if (
        !session.visible &&
        !nativeMayBeVisible &&
        (!currentActive.current || document.hidden)
      )
        return;
      if (
        nativeMayBeVisible &&
        !visibility() &&
        performance.now() < retryHideAt
      )
        return;
      const box = element.getBoundingClientRect();
      const ratio = (window.devicePixelRatio || 1) / scaleFactor;
      const finite =
        [box.x, box.y, box.width, box.height, ratio].every(Number.isFinite) &&
        ratio > 0;
      const visible = visibility() && finite && box.width > 0 && box.height > 0;
      if (session.visible !== visible) {
        session.visible = visible;
        session.visibilityRevision += 1;
      }
      const bounds = {
        x: Math.max(0, box.x) * ratio,
        y: Math.max(0, box.y) * ratio,
        width: Math.max(0, box.width + Math.min(0, box.x)) * ratio,
        height: Math.max(0, box.height + Math.min(0, box.y)) * ratio,
      };
      const globalHide = document.hidden || hasOverlay();
      const key = JSON.stringify({
        bounds,
        visible,
        globalHide,
        nativeVisibilityRevision,
      });
      if (key === last) return;
      last = key;
      const revision = ++layoutRevision;
      void queueNative(async () => {
        if (disposed || !isCurrent(session) || revision !== layoutRevision)
          return;
        // Recheck at execution time: queued "show" must never cover a dialog
        // opened while another native command was still in flight.
        if (visible && !visibility()) return;
        if (globalHide) {
          if (!nativeViewsHidden) await hideAll();
          nativeMayBeVisible = false;
          retryHideAt = 0;
        } else {
          if (visible) {
            // A lost response may follow a successful native show. Keep both
            // local and window-wide hide paths conservative until hide succeeds.
            nativeMayBeVisible = true;
            nativeViewsHidden = false;
          }
          await native("browser_tab_layout", {
            tabId: nativeId,
            bounds: finite ? bounds : { x: 0, y: 0, width: 0, height: 0 },
            visible,
          });
          nativeMayBeVisible = visible;
          retryHideAt = 0;
        }
        if (revision === layoutRevision)
          last = JSON.stringify({
            bounds,
            visible,
            globalHide,
            nativeVisibilityRevision,
          });
      }).catch(() => {
        if (!disposed && revision === layoutRevision) {
          last = "";
          // Existing periodic layout checks retry without a tight IPC loop.
          if (!visible) retryHideAt = performance.now() + 1_000;
        }
      });
    };
    updateLayout.current = layout;
    const schedule = () => {
      // Hide immediately; defer ordinary geometry updates to the next frame.
      if (!visibility()) layout();
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(layout);
    };
    const refreshScale = () => {
      void import("@tauri-apps/api/window")
        .then((api) => api.getCurrentWindow().scaleFactor())
        .then((value) => {
          if (!disposed && Number.isFinite(value) && value > 0) {
            scaleFactor = value;
            layout();
          }
        })
        .catch(() => {});
      schedule();
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(element);
    const mutations = new MutationObserver((records) => {
      if (records.some((record) => affectsNativeView(record, element)))
        schedule();
    });
    mutations.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [
        "data-state",
        "data-rift-dock-resizing",
        "hidden",
        "inert",
        "open",
        "style",
        "class",
        "role",
        "data-slot",
      ],
    });
    window.addEventListener("resize", refreshScale);
    const onScroll = (event: Event) => {
      // A sibling transcript scrolling cannot move the native browser host.
      const target = event.target;
      if (
        target === document ||
        target === window ||
        (target instanceof Element && target.contains(element))
      )
        schedule();
    };
    window.addEventListener("scroll", onScroll, true);
    document.addEventListener("visibilitychange", schedule);
    const interval = window.setInterval(layout, 100);
    refreshScale();
    layout();
    return () => {
      disposed = true;
      session.visible = false;
      session.visibilityRevision += 1;
      updateLayout.current = () => {};
      cancelAnimationFrame(raf);
      clearInterval(interval);
      observer.disconnect();
      mutations.disconnect();
      window.removeEventListener("resize", refreshScale);
      window.removeEventListener("scroll", onScroll, true);
      document.removeEventListener("visibilitychange", schedule);
    };
  }, [nativeId]);

  useLayoutEffect(() => {
    updateLayout.current();
  }, [active, url]);

  useEffect(() => {
    const session = sessionRef.current;
    if (!nativeId || !session) return;
    let disposed = false;
    let pending = false;
    const update = async () => {
      updateLayout.current();
      if (disposed || !isCurrent(session) || !session.visible || pending)
        return;
      pending = true;
      const revision = session.revision;
      const visibilityRevision = session.visibilityRevision;
      try {
        // Snapshot reads wait for queued mutations but do not hold the command
        // queue: a slow read must not delay hide-all when an overlay opens.
        await nativeCommands;
        if (
          disposed ||
          !isCurrent(session) ||
          !session.visible ||
          revision !== session.revision ||
          visibilityRevision !== session.visibilityRevision
        )
          return;
        const state = await native<Snapshot>("browser_tab_snapshot", {
          tabId: nativeId,
        });
        if (
          !disposed &&
          isCurrent(session) &&
          session.visible &&
          revision === session.revision &&
          visibilityRevision === session.visibilityRevision
        )
          applySnapshot(session, state);
      } catch {
        /* A failed poll is not evidence that the page loaded. */
      } finally {
        pending = false;
      }
    };
    void update();
    const interval = window.setInterval(update, 500);
    return () => {
      disposed = true;
      window.clearInterval(interval);
    };
    // Snapshot application reads current refs; selection is fenced above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nativeId]);

  async function navigate(address: string) {
    const next = normalizeBrowserAddress(address);
    if (!next) {
      setError("Enter a valid http or https address.");
      return;
    }
    const session = sessionRef.current;
    const previous = latestSnapshot.current?.url ?? currentUrl.current;
    currentUrl.current = next;
    setError(null);
    // Submitting does not blur the input. Keep its focused editing state so
    // subsequent keystrokes keep rendering the draft until onBlur fires.
    setUrl(next);
    setDraft(next);
    if (session && isCurrent(session)) {
      const revision = ++session.revision;
      session.pendingLocation = { previous, target: next };
      try {
        await queueNative(async () => {
          // Execute user commands in order even when a newer command has
          // superseded their displayed result (navigate, then reload/back).
          if (!isCurrent(session) || !session.created) return;
          const state = await native<Snapshot>("browser_tab_navigate", {
            tabId: session.tabId,
            url: next,
          });
          if (isCurrent(session) && revision === session.revision)
            applySnapshot(session, state);
        });
      } catch {
        if (isCurrent(session) && revision === session.revision)
          setError(
            "This page could not be opened. Try again or open it externally.",
          );
      }
    } else {
      setHistory((items) => [...items.slice(0, index + 1), next]);
      setIndex(index + 1);
      setLoading(true);
      titleCallback.current?.(new URL(next).hostname || "Browser");
    }
  }

  const previousInitial = useRef(initialUrl);
  useEffect(() => {
    if (initialUrl === previousInitial.current) return;
    previousInitial.current = initialUrl;
    if (initialUrl) void navigate(initialUrl);
    // Only an external preview URL change navigates an already-open tab.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialUrl]);

  async function action(action: "back" | "forward" | "reload" | "stop") {
    if (action === "reload") onReload?.();
    const session = sessionRef.current;
    if (session && isCurrent(session)) {
      const revision = ++session.revision;
      if (action === "back" || action === "forward")
        session.pendingLocation = {
          previous: latestSnapshot.current?.url ?? currentUrl.current,
        };
      if (action === "stop") session.pendingLocation = undefined;
      setError(null);
      try {
        await queueNative(async () => {
          if (!isCurrent(session) || !session.created) return;
          const state = await native<Snapshot>("browser_tab_action", {
            tabId: session.tabId,
            action,
          });
          if (isCurrent(session) && revision === session.revision)
            applySnapshot(session, state);
        });
      } catch {
        if (isCurrent(session) && revision === session.revision)
          setError(
            "Browser navigation is unavailable. Try reloading the page.",
          );
      }
      return;
    }
    if (action === "reload") {
      setFrameKey((key) => key + 1);
      setLoading(true);
    }
    if (action === "back" || action === "forward") {
      const next = index + (action === "back" ? -1 : 1);
      if (!history[next]) return;
      setIndex(next);
      currentUrl.current = history[next];
      setUrl(history[next]);
      setDraft(history[next]);
      setLoading(true);
    }
  }

  async function openExternal() {
    const target = normalizeBrowserAddress(currentUrl.current);
    if (!target) return;
    // Web opening is synchronous with the click, so popup blockers cannot
    // consume activation while waiting for a desktop-only bridge promise.
    if (!isTauriEnvironment()) {
      window.open(target, "_blank", "noopener,noreferrer");
      return;
    }
    try {
      if (await openInBrowser(target)) return;
    } catch {
      /* Fall back below. */
    }
    if (mounted.current) window.open(target, "_blank", "noopener,noreferrer");
  }

  const compact = Boolean(toolbarTarget);
  const externalButton = (
    <button
      type="button"
      className={styles.iconButton}
      title="Open in your browser"
      aria-label="Open page externally"
      disabled={!url}
      onClick={() => void openExternal()}
    >
      <ArrowUpRight />
    </button>
  );
  const addressBar = (
    <form
      className={styles.addressBar}
      data-compact={compact}
      onSubmit={(event) => {
        event.preventDefault();
        void navigate(draft);
      }}
    >
      <button
        type="button"
        className={styles.iconButton}
        title="Back"
        hidden={compact && (desktop ? !snapshot?.canGoBack : index < 1)}
        aria-label="Browser back"
        disabled={desktop ? !snapshot?.canGoBack : index < 1}
        onClick={() => void action("back")}
      >
        <ArrowLeft />
      </button>
      <button
        type="button"
        className={styles.iconButton}
        title="Forward"
        hidden={
          compact &&
          (desktop ? !snapshot?.canGoForward : index >= history.length - 1)
        }
        aria-label="Browser forward"
        disabled={
          desktop ? !snapshot?.canGoForward : index >= history.length - 1
        }
        onClick={() => void action("forward")}
      >
        <ArrowRight />
      </button>
      <button
        type="button"
        className={styles.iconButton}
        aria-label={snapshot?.loading ? "Stop loading" : "Reload page"}
        disabled={!url}
        onClick={() => void action(snapshot?.loading ? "stop" : "reload")}
      >
        {snapshot?.loading ? <X /> : <RotateCw />}
      </button>
      <input
        aria-label="Browser address"
        placeholder="Enter a URL"
        spellCheck={false}
        autoComplete="off"
        value={editing ? draft : url}
        onFocus={(event) => {
          setDraft(url);
          setEditing(true);
          event.currentTarget.select();
        }}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => setEditing(false)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setDraft(url);
            event.currentTarget.blur();
          }
        }}
      />
      {compact ? (
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className={styles.iconButton}
              aria-label="Preview options"
              title="Preview options"
            >
              <Ellipsis />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className={styles.previewOptions}>
            <span>Preview</span>
            <div>
              {externalButton}
              {toolbar}
            </div>
          </PopoverContent>
        </Popover>
      ) : (
        <>
          {externalButton}
          {toolbar}
        </>
      )}
    </form>
  );
  return (
    <section className={styles.browser} aria-label="Browser">
      {toolbarTarget ? createPortal(addressBar, toolbarTarget) : addressBar}
      {error && (
        <div className={styles.browserError} role="alert">
          {error}
        </div>
      )}
      <div
        ref={viewport}
        className={styles.browserViewport}
        data-native-browser-host={nativeId ?? undefined}
      >
        {!url ? (
          <div className={styles.empty}>
            <Globe strokeWidth={1.4} />
            <h3>Start browsing</h3>
            <p>Enter a URL to open a page.</p>
          </div>
        ) : desktop ? (
          <div className={styles.empty} aria-live="polite">
            {!nativeId && !error ? "Opening browser…" : null}
          </div>
        ) : (
          <iframe
            key={frameKey}
            src={url}
            title="Web page preview"
            sandbox={`allow-scripts allow-forms allow-popups${preservesPreviewOrigin ? " allow-same-origin" : ""}`}
            referrerPolicy="strict-origin-when-cross-origin"
            onLoad={() => setLoading(false)}
          />
        )}
      </div>
      {!desktop && url && (
        <div className={styles.browserNote}>
          {loading ? "Loading preview…" : "Web preview"}
          <span>Some sites require your browser.</span>
          <button type="button" onClick={() => void openExternal()}>
            Open externally <ArrowUpRight />
          </button>
        </div>
      )}
    </section>
  );
}
