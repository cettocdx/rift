"use client";

import { useLayoutEffect, useRef } from "react";
import { splitComposerCommand } from "@/lib/composer/command-highlight";
import styles from "./ComposerCommandPaint.module.css";

/**
 * Shared defaults; the mirror also copies computed textarea metrics because
 * shell styles and user typography preferences can override these classes.
 */
export const COMPOSER_TEXT_METRICS_CLASS =
  "px-3 py-2 font-sans text-ui leading-5";

const MIRRORED_TEXT_PROPERTIES = [
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "font-stretch",
  "font-kerning",
  "font-variant",
  "font-feature-settings",
  "font-variation-settings",
  "line-height",
  "letter-spacing",
  "word-spacing",
  "text-align",
  "text-indent",
  "text-transform",
  "text-rendering",
  "tab-size",
  "white-space",
  "word-break",
  "overflow-wrap",
  "direction",
  "padding",
] as const;

export function ComposerCommandPaint({
  input,
  /** The textarea being mirrored; scroll is copied from it. */
  textareaRef,
}: {
  input: string;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
}) {
  const mirrorRef = useRef<HTMLDivElement | null>(null);

  // Paint at the real caret's position before the browser displays a resolved
  // command, including shell padding, font preferences and scrollbar width.
  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    const mirror = mirrorRef.current;
    if (!textarea || !mirror) return;
    const syncScroll = () => {
      mirror.scrollTop = textarea.scrollTop;
      mirror.scrollLeft = textarea.scrollLeft;
    };
    const syncMetrics = () => {
      const computed = getComputedStyle(textarea);
      for (const property of MIRRORED_TEXT_PROPERTIES) {
        mirror.style.setProperty(property, computed.getPropertyValue(property));
      }
      mirror.style.boxSizing = "border-box";
      mirror.style.width = `${textarea.clientWidth}px`;
      mirror.style.height = `${textarea.clientHeight}px`;
      syncScroll();
    };
    syncMetrics();
    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(syncMetrics);
    resizeObserver?.observe(textarea);
    const appearanceObserver = new MutationObserver(syncMetrics);
    appearanceObserver.observe(document.documentElement, { attributes: true });
    window.addEventListener("resize", syncMetrics);
    document.fonts?.addEventListener("loadingdone", syncMetrics);
    textarea.addEventListener("scroll", syncScroll);
    return () => {
      resizeObserver?.disconnect();
      appearanceObserver.disconnect();
      window.removeEventListener("resize", syncMetrics);
      document.fonts?.removeEventListener("loadingdone", syncMetrics);
      textarea.removeEventListener("scroll", syncScroll);
    };
  }, [textareaRef, input]);

  const segments = splitComposerCommand(input);
  if (!segments.some((segment) => segment.kind === "command")) return null;

  return (
    <div
      ref={mirrorRef}
      aria-hidden
      data-ui="composer-command-paint"
      className={`${styles.mirror} ${COMPOSER_TEXT_METRICS_CLASS}`}
    >
      {segments.map((segment, index) =>
        segment.kind === "command" ? (
          <span
            key={index}
            data-ui="composer-command-token"
            className={styles.token}
          >
            {segment.text}
          </span>
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
    </div>
  );
}
