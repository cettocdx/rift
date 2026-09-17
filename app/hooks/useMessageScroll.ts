import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ChatScrollPosition } from "@/app/contexts/ChatViewStateContext";
import { STICKY_BOTTOM_ESCAPE_EVENT } from "@/lib/utils/scroll-events";
import { scrollAnchorText } from "@/lib/utils/scroll-anchor-text";

function useScrollElementRef() {
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  const ref = useMemo(() => {
    const callback = Object.assign(
      (element: HTMLDivElement | null) => {
        callback.current = element;
        setNode(element);
      },
      { current: null as HTMLDivElement | null },
    );
    return callback;
  }, []);
  return [ref, node] as const;
}

/** Follow output only by reader intent. Layout changes never re-enable follow. */
export const useMessageScroll = (
  view?: { scroll?: ChatScrollPosition },
  hasScrollSurface = true,
) => {
  const initialPosition = useMemo(() => view?.scroll, [view]);
  const [scrollRef, scrollNode] = useScrollElementRef();
  const [contentRef, contentNode] = useScrollElementRef();
  const [isAtBottom, setIsAtBottom] = useState(
    initialPosition?.atBottom !== false,
  );
  const jumpRef = useRef<
    (options?: { force?: boolean; instant?: boolean }) => boolean
  >(() => false);

  useLayoutEffect(() => {
    const element = scrollRef.current;
    const content = contentRef.current;
    if (!hasScrollSurface || !element || !content) return;
    const saved = view?.scroll ?? initialPosition;
    let following = saved?.atBottom !== false;
    let jumping = false;
    let expectedTop: number | undefined;
    let lastTop = element.scrollTop;
    let anchor: { node: Element; offset: number } | undefined;
    let geometry = "";
    let pinnedRow: HTMLElement | undefined;
    let releaseFrame: number | undefined;
    let reobserveFrame: number | undefined;
    let previousVisibility = "";
    let previousVisibilityPriority = "";
    const pinAnchorRow = (node?: Element) => {
      if (releaseFrame !== undefined) {
        cancelAnimationFrame(releaseFrame);
        releaseFrame = undefined;
      }
      const row = node?.closest<HTMLElement>("[data-message-id]") ?? undefined;
      if (row === pinnedRow) return;
      if (pinnedRow) {
        if (previousVisibility)
          pinnedRow.style.setProperty(
            "content-visibility",
            previousVisibility,
            previousVisibilityPriority,
          );
        else pinnedRow.style.removeProperty("content-visibility");
      }
      pinnedRow = row;
      if (row) {
        previousVisibility = row.style.getPropertyValue("content-visibility");
        previousVisibilityPriority =
          row.style.getPropertyPriority("content-visibility");
        // A skipped subtree can return descendant rectangles without painting
        // that row. Materialize only the reader's anchor, never all history.
        row.style.setProperty("content-visibility", "visible");
      }
    };
    const previousAnchorStyle = element.style.overflowAnchor;
    const previousBehavior = element.style.scrollBehavior;
    // One owner for anchoring; native anchoring and a spring must not fight.
    element.style.overflowAnchor = "none";
    element.style.scrollBehavior = "auto";
    const bottom = () =>
      Math.max(0, element.scrollHeight - element.clientHeight);
    const dimensions = () =>
      `${element.clientWidth}:${element.clientHeight}:${element.scrollHeight}`;
    const blockText = scrollAnchorText;
    const describeAnchor = (): ChatScrollPosition["anchor"] => {
      if (following || !anchor) return undefined;
      const row = anchor.node.closest("[data-message-id]");
      const messageId = row?.getAttribute("data-message-id");
      if (!row || !messageId) return undefined;
      const selector = anchor.node.matches("[data-ui='tool-block']")
        ? "[data-ui='tool-block']"
        : anchor.node.matches("[role='button']")
          ? "[role='button']"
          : anchor.node.tagName.toLowerCase();
      return {
        messageId,
        selector,
        index: Array.from(row.querySelectorAll(selector)).indexOf(anchor.node),
        text: blockText(anchor.node),
        offset: anchor.offset,
      };
    };
    const remember = () => {
      if (view) {
        const retainedAnchor = describeAnchor();
        view.scroll = {
          top: element.scrollTop,
          atBottom: following,
          ...(retainedAnchor ? { anchor: retainedAnchor } : {}),
        };
      }
    };
    const follow = (value: boolean) => {
      following = value;
      if (value) pinAnchorRow();
      setIsAtBottom(value);
    };
    const captureAnchor = () => {
      // A keyboard/question dock can temporarily leave no visible transcript.
      // Keep the last reader anchor through hidden reflow instead of replacing
      // it with a block chosen from an empty viewport.
      if (element.clientHeight === 0) return;
      const previous = anchor;
      anchor = undefined;
      if (following) return;
      const viewport = element.getBoundingClientRect();
      if (previous && content.contains(previous.node)) {
        const rect = previous.node.getBoundingClientRect();
        if (rect.bottom > viewport.top && rect.top < viewport.bottom) {
          anchor = { node: previous.node, offset: rect.top - viewport.top };
          return;
        }
      }
      // Semantic blocks survive streaming updates. Keep the first visible block
      // at the same offset when media loads or the dock changes line wrapping.
      const selector =
        "p, pre, li, h1, h2, h3, h4, img, [data-ui='tool-block']";
      const rows = content.querySelectorAll<HTMLElement>("[data-message-id]");
      // Chat rows do not overlap and follow DOM order. Binary-search the first
      // visible row before inspecting its blocks; reading all historical block
      // rectangles defeats content-visibility on long conversations.
      let low = 0;
      let high = rows.length;
      while (low < high) {
        const middle = (low + high) >>> 1;
        if (rows[middle].getBoundingClientRect().bottom <= viewport.top)
          low = middle + 1;
        else high = middle;
      }
      const candidates: Element[] = [];
      if (rows.length) {
        for (let index = low; index < rows.length; index++) {
          if (rows[index].getBoundingClientRect().top >= viewport.bottom) break;
          candidates.push(rows[index]);
        }
      } else candidates.push(content); // Non-chat consumers have no row wrappers.
      for (const candidate of candidates) {
        for (const node of candidate.querySelectorAll(selector)) {
          const rect = node.getBoundingClientRect();
          if (rect.bottom > viewport.top && rect.top < viewport.bottom) {
            anchor = { node, offset: rect.top - viewport.top };
            return;
          }
        }
      }
    };
    const place = (top: number) => {
      element.scrollTop = Math.max(0, Math.min(bottom(), top));
      expectedTop = element.scrollTop;
      lastTop = element.scrollTop;
      remember();
    };
    const resize = () => {
      geometry = dimensions();
      if (following) {
        // ResizeObserver runs before paint. Follow new output in the same frame,
        // without a 350ms spring being restarted for every token/layout change.
        place(bottom());
      } else if (anchor && content.contains(anchor.node)) {
        place(
          element.scrollTop +
            anchor.node.getBoundingClientRect().top -
            element.getBoundingClientRect().top -
            anchor.offset,
        );
      } else {
        place(element.scrollTop);
      }
      captureAnchor();
      // Never toggle content-visibility inside ResizeObserver delivery. A row
      // that ceased to own the anchor can return to normal skipping next frame.
      if (
        pinnedRow &&
        (!anchor || !pinnedRow.contains(anchor.node)) &&
        releaseFrame === undefined
      ) {
        releaseFrame = requestAnimationFrame(() => {
          releaseFrame = undefined;
          if (!anchor || !pinnedRow?.contains(anchor.node)) pinAnchorRow();
        });
      }
    };
    const stop = () => {
      pinAnchorRow();
      jumping = false;
      follow(false);
      place(element.scrollTop); // cancel an explicit smooth jump as well
      captureAnchor();
    };
    const onScroll = () => {
      const top = element.scrollTop;
      // A viewport resize may emit scroll before ResizeObserver. It is not
      // reader intent, even when clamping temporarily puts us at the bottom.
      if (geometry !== dimensions()) {
        const sameViewport = geometry.startsWith(
          `${element.clientWidth}:${element.clientHeight}:`,
        );
        const ownPlacement =
          expectedTop !== undefined && Math.abs(top - expectedTop) < 1;
        const clamped = lastTop > bottom() && Math.abs(top - bottom()) < 1;
        if (!sameViewport || top === lastTop || ownPlacement || clamped) {
          resize();
          return;
        }
        // Scrolling into content-visibility:auto history materializes rows and
        // changes scrollHeight before this event. That change must not restore
        // the previous anchor and undo the reader's actual movement.
        geometry = dimensions();
      }
      if (expectedTop !== undefined && Math.abs(top - expectedTop) < 1) {
        expectedTop = undefined;
        remember();
        return;
      }
      expectedTop = undefined;
      pinAnchorRow(); // An actual reader scroll ends retained-row materialization.
      const nearBottom = bottom() - top < 32;
      if (jumping) {
        if (nearBottom) jumping = false;
      } else {
        follow(nearBottom && top >= lastTop);
      }
      lastTop = top;
      captureAnchor();
      remember();
    };
    const onWheel = (event: WheelEvent) => {
      // Once detached, let native scrolling run. Repeating stop() on every
      // trackpad event writes scrollTop and measures layout before onScroll.
      if (event.deltaY < 0 && (following || jumping)) stop();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.button > 0 || event.isPrimary === false) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const control = target.closest(
        "button, a[href], summary, [role='button'], input, textarea, select",
      );
      if (!control || !content.contains(control)) return;
      // A streaming resize must preserve the control being pressed, rather
      // than a nearby paragraph. Otherwise pointerup can land on a different
      // node and the browser legitimately cancels the button's click.
      const rect = control.getBoundingClientRect();
      const viewportTop = element.getBoundingClientRect().top;
      // WebKit can hit-test against the last painted position while skipped
      // history materializes. Honor that hit target when its freshly measured
      // bounds no longer include the press; keep it under the stationary pointer.
      const staleHit =
        Number.isFinite(event.clientY) &&
        rect.height > 0 &&
        (event.clientY < rect.top || event.clientY > rect.bottom);
      const offset =
        (staleHit ? event.clientY - rect.height / 2 : rect.top) - viewportTop;
      jumping = false;
      follow(false);
      anchor = { node: control, offset };
      pinAnchorRow(control);
      resize();
    };
    const onKey = (event: KeyboardEvent) => {
      if (
        (following || jumping) &&
        ["ArrowUp", "PageUp", "Home"].includes(event.key)
      )
        stop();
    };
    jumpRef.current = (options) => {
      if (!options?.force && !following) return false;
      follow(true);
      anchor = undefined;
      const smooth =
        !options?.instant &&
        !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      if (smooth && element.scrollTo) {
        jumping = true;
        element.scrollTo({ top: bottom(), behavior: "smooth" });
      } else place(bottom());
      remember();
      return true;
    };
    // Restore one known row/block before paint. Numeric positions alone drift
    // when content-visibility estimates reset after leaving and reopening chat.
    const retained = saved?.anchor;
    if (
      !following &&
      retained &&
      Number.isFinite(retained.offset) &&
      /^(p|pre|li|h[1-4]|img|button|a|summary|input|textarea|select|\[role='button'\]|\[data-ui='tool-block'\])$/.test(
        retained.selector,
      )
    ) {
      const row = Array.from(
        content.querySelectorAll("[data-message-id]"),
      ).find(
        (node) => node.getAttribute("data-message-id") === retained.messageId,
      );
      const blocks = row
        ? Array.from(row.querySelectorAll(retained.selector))
        : [];
      const indexed = blocks[retained.index];
      const matches = blocks.filter(
        (block) => blockText(block) === retained.text,
      );
      const node =
        indexed && blockText(indexed) === retained.text
          ? indexed
          : matches.length === 1
            ? matches[0]
            : undefined;
      if (node) {
        pinAnchorRow(node);
        anchor = { node, offset: retained.offset };
      }
    }
    follow(following);
    const restoredTop = anchor
      ? element.scrollTop +
        anchor.node.getBoundingClientRect().top -
        element.getBoundingClientRect().top -
        anchor.offset
      : (saved?.top ?? element.scrollTop);
    place(following ? bottom() : restoredTop);
    geometry = dimensions();
    captureAnchor();
    const observer = new ResizeObserver((entries) => {
      resize();
      const deliveredBox = entries.find((entry) => entry.target === content)
        ?.borderBoxSize?.[0];
      // Skipped history can materialize while correcting the reading anchor.
      // Keep the pre-paint correction, but avoid redelivering a changed ancestor
      // in the same observer cycle. Only rearm when its delivered size is stale;
      // unconditional reobservation would schedule work every frame forever.
      if (
        deliveredBox &&
        reobserveFrame === undefined &&
        (Math.abs(content.offsetHeight - deliveredBox.blockSize) > 1 ||
          Math.abs(content.offsetWidth - deliveredBox.inlineSize) > 1)
      ) {
        observer.unobserve(content);
        reobserveFrame = requestAnimationFrame(() => {
          reobserveFrame = undefined;
          observer.observe(content);
        });
      }
    });
    observer.observe(content);
    observer.observe(element);
    element.addEventListener("scroll", onScroll, { passive: true });
    element.addEventListener("wheel", onWheel, { passive: true });
    element.addEventListener("pointerdown", onPointerDown, { passive: true });
    element.addEventListener("keydown", onKey);
    element.addEventListener(STICKY_BOTTOM_ESCAPE_EVENT, stop);
    window.addEventListener(STICKY_BOTTOM_ESCAPE_EVENT, stop);
    return () => {
      remember();
      pinAnchorRow();
      observer.disconnect();
      if (reobserveFrame !== undefined) cancelAnimationFrame(reobserveFrame);
      element.removeEventListener("scroll", onScroll);
      element.removeEventListener("wheel", onWheel);
      element.removeEventListener("pointerdown", onPointerDown);
      element.removeEventListener("keydown", onKey);
      element.removeEventListener(STICKY_BOTTOM_ESCAPE_EVENT, stop);
      window.removeEventListener(STICKY_BOTTOM_ESCAPE_EVENT, stop);
      element.style.overflowAnchor = previousAnchorStyle;
      element.style.scrollBehavior = previousBehavior;
      jumpRef.current = () => false;
    };
  }, [
    view,
    initialPosition,
    hasScrollSurface,
    scrollNode,
    contentNode,
    scrollRef,
    contentRef,
  ]);

  const scrollToBottom = useCallback(
    (options?: { force?: boolean; instant?: boolean }) =>
      jumpRef.current(options),
    [],
  );
  return { scrollRef, contentRef, isAtBottom, scrollToBottom };
};
