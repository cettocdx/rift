"use client";

import { useEffect, useState } from "react";

/**
 * The window strip's portal targets, but only while the strip is on screen.
 *
 * The strip is a desktop surface: below 768px it is `display: none`, because a
 * phone has no traffic lights to sit beside and no window to drag. Its slots
 * are still in the document at that width, so portalling into one blindly
 * hands the content to a hidden container -- which is how the terminal,
 * preview and panel controls disappeared from the narrow layout entirely
 * rather than falling back to their inline row.
 *
 * So the slot is reported only when the strip is actually displayed, and the
 * caller renders inline when it is not. The breakpoint is the same 768px the
 * stylesheet uses; it is watched rather than read once, so rotating a tablet
 * or dragging a window across the boundary moves the controls with it.
 */
export function useWindowStripSlot(id: string): HTMLElement | null {
  const [slot, setSlot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const wideEnough = window.matchMedia("(min-width: 768px)");
    let observer: MutationObserver | undefined;
    const sync = () => {
      const element = document.getElementById(id);
      setSlot(wideEnough.matches ? element : null);
      if (element) observer?.disconnect();
    };

    // The shell can mount after the conversation on a cold load. Wait for
    // its slot instead of permanently stranding controls below the titlebar.
    if (!document.getElementById(id)) {
      observer = new MutationObserver(sync);
      observer.observe(document.body, { childList: true, subtree: true });
    }
    sync();
    wideEnough.addEventListener("change", sync);
    return () => {
      observer?.disconnect();
      wideEnough.removeEventListener("change", sync);
    };
  }, [id]);

  return slot;
}
