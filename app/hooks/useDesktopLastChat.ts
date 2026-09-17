"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { isTauriEnvironment } from "@/app/hooks/useTauri";

const validChatPath = (path: string | null): path is string =>
  path !== null && /^\/c\/[a-zA-Z0-9_-]{1,128}$/.test(path);

export function createDesktopChatNavigationSession(
  launchPath: string | null = null,
) {
  return {
    bootHandled: false,
    launchPath,
    owner: undefined as string | undefined,
    restoring: null as string | null,
    blockedPath: null as string | null,
  };
}
// One JS document, not one route-group mount. A return from /workspace must
// respect the user's explicit Home action instead of replaying boot restoration.
function documentLaunchPath(): string | null {
  try {
    const entry = performance.getEntriesByType("navigation")[0];
    return entry ? new URL(entry.name).pathname : null;
  } catch {
    return null;
  }
}
const desktopSession = createDesktopChatNavigationSession(documentLaunchPath());

/** Remember navigation only. Restoring a location must never submit a task. */
export function useDesktopLastChat(
  ownerId: string | undefined,
  initialSession = desktopSession,
) {
  const sessionRef = useRef(initialSession);
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    const session = sessionRef.current;
    if (!ownerId || !pathname || !isTauriEnvironment()) return;
    const key = `rift:desktop:last-chat:${ownerId}`;
    try {
      if (session.owner !== ownerId) {
        // An actual account change must not save the previously mounted
        // account's location. Initial authenticated deep links are remembered.
        session.blockedPath =
          session.owner && pathname !== "/" ? pathname : null;
        session.owner = ownerId;
        session.restoring = null;
      }
      if (!session.bootHandled) {
        session.bootHandled = true;
        const saved = localStorage.getItem(key);
        // An explicit deep link, search or hash wins over restoration.
        if (
          session.launchPath === "/" &&
          pathname === "/" &&
          !window.location.search &&
          !window.location.hash &&
          validChatPath(saved)
        ) {
          session.restoring = saved;
          router.replace(saved);
          return;
        }
      }
      if (session.blockedPath === pathname) return;
      session.blockedPath = null;
      // Strict effects must not overwrite the saved route with the launch
      // root while replace() is still in flight.
      if (session.restoring && pathname === "/") return;
      session.restoring = null;
      if (pathname === "/" || validChatPath(pathname)) {
        localStorage.setItem(key, pathname);
      }
    } catch {
      // Disabled/full storage must never prevent opening or using the app.
      session.restoring = null;
    }
  }, [ownerId, pathname, router]);
}
