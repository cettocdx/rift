"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight } from "lucide-react";

/** Workbench history also covers routes replaced after a new conversation.
 * Navigate the recorded path directly: router.back() could leave the app when
 * that previous route was replaced rather than pushed into browser history. */
export function WorkspaceHistoryNavigation() {
  const pathname = usePathname();
  const router = useRouter();
  const [history, setHistory] = useState({ paths: [pathname], index: 0 });
  const pending = useRef<"back" | "forward" | null>(null);
  useEffect(() => {
    setHistory((current) => {
      if (current.paths[current.index] === pathname) return current;
      const step = pending.current;
      pending.current = null;
      if (step === "back" && current.paths[current.index - 1] === pathname)
        return { ...current, index: current.index - 1 };
      if (step === "forward" && current.paths[current.index + 1] === pathname)
        return { ...current, index: current.index + 1 };
      // Browser / system back and forward also update the same controls.
      if (current.paths[current.index - 1] === pathname)
        return { ...current, index: current.index - 1 };
      if (current.paths[current.index + 1] === pathname)
        return { ...current, index: current.index + 1 };
      const paths = [...current.paths.slice(0, current.index + 1), pathname];
      return { paths, index: paths.length - 1 };
    });
  }, [pathname]);

  return (
    <nav aria-label="Page history" className="rift-history-navigation">
      <button
        type="button"
        aria-label="Go back"
        title="Go back"
        disabled={history.index === 0}
        onClick={() => {
          pending.current = "back";
          router.push(history.paths[history.index - 1]);
        }}
      >
        <ArrowLeft aria-hidden className="size-3.5" strokeWidth={1.5} />
      </button>
      <button
        type="button"
        aria-label="Go forward"
        title="Go forward"
        disabled={history.index >= history.paths.length - 1}
        onClick={() => {
          pending.current = "forward";
          router.push(history.paths[history.index + 1]);
        }}
      >
        <ArrowRight aria-hidden className="size-3.5" strokeWidth={1.5} />
      </button>
    </nav>
  );
}
