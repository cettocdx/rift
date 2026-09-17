"use client";

import { useLayoutEffect, useState } from "react";

const PROPERTY = "--rift-workbench-titlebar-inset";

/** Keep the global title/actions within the conversation beside a right dock. */
export function useWorkbenchTitlebarInset(enabled: boolean) {
  // A callback ref makes a late mount/replacement an effect dependency. A plain
  // mutable ref can remain unobserved when the first commit has no pane.
  const [pane, attachPane] = useState<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const shell = pane?.closest<HTMLElement>(".pro-shell");
    if (!pane || !shell) return;
    const previous = shell.style.getPropertyValue(PROPERTY);
    const previousPriority = shell.style.getPropertyPriority(PROPERTY);
    let disposed = false;
    const update = () => {
      if (disposed) return;
      const width = enabled ? pane.getBoundingClientRect().width : 0;
      shell.style.setProperty(PROPERTY, `${Math.max(0, width)}px`);
    };
    const observer = new ResizeObserver(update);
    observer.observe(pane);
    update();
    return () => {
      disposed = true;
      observer.disconnect();
      if (previous)
        shell.style.setProperty(PROPERTY, previous, previousPriority);
      else shell.style.removeProperty(PROPERTY);
    };
  }, [pane, enabled]);

  return attachPane;
}
