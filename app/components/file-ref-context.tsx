"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { getPerFileDiffStats } from "./agent-activity";
import type { SidebarContent } from "@/types/chat";

/**
 * The run's changed files, resolvable from prose.
 *
 * The reference agent writes `AGENTS.md` in a sentence and the token is blue
 * and clickable -- it opens the file. For that to be honest the affordance
 * must exist only when there is somewhere to go, so this context maps the
 * CURRENT run's mutated paths (full path and basename both) to the execution
 * that can be opened in the computer sidebar. A code span that resolves here
 * is a reference; one that does not stays ordinary code, because painting it
 * blue would be a promise the click cannot keep.
 */
const FileRefContext = createContext<ReadonlyMap<string, SidebarContent>>(
  new Map(),
);

export function FileRefProvider({
  toolExecutions,
  children,
}: {
  toolExecutions: readonly SidebarContent[];
  children: ReactNode;
}) {
  const value = useMemo(() => {
    const map = new Map<string, SidebarContent>();
    for (const stat of getPerFileDiffStats(toolExecutions)) {
      map.set(stat.path, stat.execution);
      const base = stat.path.split("/").filter(Boolean).pop();
      // Basename resolution: prose says "AGENTS.md", the run knows the path.
      // On a collision the later (fresher) file wins, which matches what a
      // reader means by the bare name at the end of a run.
      if (base) map.set(base, stat.execution);
    }
    return map;
  }, [toolExecutions]);

  return (
    <FileRefContext.Provider value={value}>{children}</FileRefContext.Provider>
  );
}

export function useFileRef(text: string | null): SidebarContent | undefined {
  const map = useContext(FileRefContext);
  if (!text) return undefined;
  return map.get(text.trim());
}
