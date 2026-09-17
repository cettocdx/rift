"use client";

import { useLayoutEffect } from "react";

type ShellKind = "pro" | "workspace" | "chat";
const owners = new WeakMap<Document, Map<ShellKind, number>>();

/** Explicit shell ownership replaces document-wide descendant selectors.
 * Register beside the actual shell element, never on a provider that may not
 * render a shell. Multiple shells and Strict Mode cleanup share each marker.
 */
export function registerRootShell(document: Document, kind: ShellKind) {
  const counts = owners.get(document) ?? new Map<ShellKind, number>();
  owners.set(document, counts);
  const attribute = `data-rift-shell-${kind}`;
  const roots = [document.documentElement, document.body];
  const count = counts.get(kind) ?? 0;
  counts.set(kind, count + 1);
  if (count === 0) roots.forEach((root) => root.setAttribute(attribute, ""));
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const remaining = (counts.get(kind) ?? 1) - 1;
    if (remaining > 0) counts.set(kind, remaining);
    else {
      counts.delete(kind);
      roots.forEach((root) => root.removeAttribute(attribute));
    }
  };
}

/** No DOM, observers, polling, or updates when shell contents change. */
export function RootShellPresence({ kind }: { kind: ShellKind }) {
  useLayoutEffect(() => registerRootShell(document, kind), [kind]);
  return null;
}
