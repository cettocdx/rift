"use client";

import { RootShellPresence } from "@/app/components/RootShellPresence";
import { useEffect, useRef, type HTMLAttributes } from "react";

const HEIGHT = "--rift-chat-viewport-height";
const OFFSET = "--rift-chat-viewport-offset";
const ACTIVE = "data-rift-visible-viewport";

/** Follow a reported mobile visual viewport without rerendering the transcript.
 * This consumes browser measurements; it does not predict a keyboard height.
 */
export function observeChatViewport(element: HTMLElement): () => void {
  const viewport = window.visualViewport;
  if (!viewport) return () => {};
  const mobile = window.matchMedia("(max-width: 767px) and (pointer: coarse)");
  const previous = [HEIGHT, OFFSET].map((name) => ({
    name,
    value: element.style.getPropertyValue(name),
    priority: element.style.getPropertyPriority(name),
  }));
  const previousActive = element.getAttribute(ACTIVE);
  let frame = 0;
  let applied = false;
  const restore = () => {
    if (!applied) return;
    for (const { name, value, priority } of previous) {
      if (value) element.style.setProperty(name, value, priority);
      else element.style.removeProperty(name);
    }
    if (previousActive === null) element.removeAttribute(ACTIVE);
    else element.setAttribute(ACTIVE, previousActive);
    applied = false;
  };
  const update = () => {
    frame = 0;
    // Pinch zoom must keep the normal document geometry and native panning.
    if (
      !mobile.matches ||
      !Number.isFinite(viewport.scale) ||
      Math.abs(viewport.scale - 1) > 0.01 ||
      !Number.isFinite(window.innerHeight) ||
      window.innerHeight <= 0 ||
      !Number.isFinite(viewport.height) ||
      viewport.height <= 0 ||
      !Number.isFinite(viewport.offsetTop)
    ) {
      restore();
      return;
    }
    // iOS Safari can shrink innerHeight to the keyboard's visual height while
    // the layout viewport (100dvh/clientHeight) stays tall. Comparing only the
    // two visual heights incorrectly releases the shell during text entry.
    const layoutHeight = Math.max(
      window.innerHeight,
      document.documentElement.clientHeight,
    );
    const height = Math.min(layoutHeight, viewport.height);
    const offset = Math.max(
      0,
      Math.min(viewport.offsetTop, layoutHeight - height),
    );
    if (layoutHeight - height < 1 && offset === 0) {
      restore();
      return;
    }
    for (const [name, value] of [
      [HEIGHT, `${height}px`],
      [OFFSET, `${offset}px`],
    ]) {
      if (element.style.getPropertyValue(name) !== value)
        element.style.setProperty(name, value);
    }
    if (!element.hasAttribute(ACTIVE)) element.setAttribute(ACTIVE, "");
    applied = true;
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(update);
  };
  viewport.addEventListener("resize", schedule);
  viewport.addEventListener("scroll", schedule);
  window.addEventListener("resize", schedule);
  mobile.addEventListener("change", schedule);
  update();
  return () => {
    viewport.removeEventListener("resize", schedule);
    viewport.removeEventListener("scroll", schedule);
    window.removeEventListener("resize", schedule);
    mobile.removeEventListener("change", schedule);
    if (frame) cancelAnimationFrame(frame);
    restore();
  };
}

export function ChatViewport({
  children,
  className = "",
  ...props
}: HTMLAttributes<HTMLDivElement> & { "data-rift-route-shell"?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(
    () => (ref.current ? observeChatViewport(ref.current) : undefined),
    [],
  );
  return (
    <div
      {...props}
      ref={ref}
      className={`rift-chat-viewport flex h-dvh min-h-0 flex-col overflow-hidden bg-background ${className}`}
    >
      {props["data-rift-route-shell"] === "chat" && (
        <RootShellPresence kind="chat" />
      )}
      {children}
    </div>
  );
}
