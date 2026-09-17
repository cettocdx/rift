"use client";

import {
  useEffect,
  useCallback,
  useSyncExternalStore,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import { HackerMode } from "@/app/components/HackerMode";

const memorySessions = new Map<string, string>();
const previousSessions = new Map<string, string>();
const sessionListeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  sessionListeners.add(listener);
  return () => {
    sessionListeners.delete(listener);
  };
};
const serverSession = () => undefined;
const SESSION_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Reopening the workbench returns to this account's session in this window. */
export function HackSessionEntry({
  accountId,
  requestedSession,
  durableEnabled = false,
}: {
  accountId: string;
  requestedSession?: string;
  durableEnabled?: boolean;
}) {
  const router = useRouter();
  const [isNavigating, startNavigation] = useTransition();
  const getSession = useCallback(() => {
    if (requestedSession) return requestedSession;
    try {
      const saved = sessionStorage.getItem(`rift:hack-session:${accountId}`);
      return saved && SESSION_ID.test(saved) ? saved : undefined;
    } catch {
      return memorySessions.get(accountId);
    }
  }, [accountId, requestedSession]);
  const storedSession = useSyncExternalStore(
    subscribe,
    getSession,
    serverSession,
  );
  const session = requestedSession ?? storedSession;
  const getPreviousSession = useCallback(
    () => previousSessions.get(accountId),
    [accountId],
  );
  const previousSession = useSyncExternalStore(
    subscribe,
    getPreviousSession,
    serverSession,
  );
  const startNewAssessment = useCallback(() => {
    startNavigation(() => {
      router.push(`/hack?session=${crypto.randomUUID()}`);
    });
  }, [router, startNavigation]);
  const returnToPreviousAssessment = useCallback(() => {
    if (previousSession)
      startNavigation(() => {
        router.push(`/hack?session=${previousSession}`);
      });
  }, [previousSession, router, startNavigation]);
  useEffect(() => {
    const key = `rift:hack-session:${accountId}`;
    let saved: string | null = null;
    try {
      saved = sessionStorage.getItem(key);
    } catch {
      saved = memorySessions.get(accountId) ?? null;
    }
    const next =
      requestedSession ??
      (saved && SESSION_ID.test(saved) ? saved : crypto.randomUUID());
    const committed = memorySessions.get(accountId) ?? saved;
    if (committed && SESSION_ID.test(committed) && committed !== next)
      previousSessions.set(accountId, committed);
    memorySessions.set(accountId, next);
    try {
      sessionStorage.setItem(key, next);
    } catch {
      // The account's committed selection is also kept in memory above.
    }
    sessionListeners.forEach((listener) => listener());
    if (!requestedSession) router.replace(`/hack?session=${next}`);
  }, [accountId, requestedSession, router]);
  return session ? (
    <>
      {/* Keep the producer attached, but never send into the old session while
        the server is resolving a different assessment route. */}
      <div
        className="contents"
        inert={isNavigating || undefined}
        aria-busy={isNavigating}
      >
        <HackerMode
          key={`${accountId}:${session}`}
          accountId={accountId}
          chatId={session}
          durableEnabled={durableEnabled}
          onNewAssessment={startNewAssessment}
          onPreviousAssessment={
            previousSession && previousSession !== session
              ? returnToPreviousAssessment
              : undefined
          }
        />
      </div>
      {isNavigating && (
        <div
          role="status"
          aria-label="Opening assessment"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
        >
          <span className="rounded-lg border border-white/15 bg-black px-4 py-3 text-sm text-white/80">
            Opening assessment…
          </span>
        </div>
      )}
    </>
  ) : (
    <div
      className="min-h-dvh bg-black"
      role="status"
      aria-label="Opening Hack Workbench"
    />
  );
}
