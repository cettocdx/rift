"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  DESKTOP_TERMINAL_OWNER_CHANGED_EVENT,
  DESKTOP_TERMINAL_OWNER_READY_EVENT,
} from "@/app/services/desktop-terminal-owner";
import { isTauriEnvironment } from "@/app/hooks/useTauri";
import {
  DESKTOP_LOCAL_ACCESS_CHANGED_EVENT,
  listDesktopWorkspaceGrants,
  requestDesktopWorkspaceAccess,
  revokeDesktopWorkspaceAccess,
  type DesktopWorkspaceGrant,
} from "@/app/services/desktop-local-access";
import type { BuildDesktopAccessState } from "@/app/components/BuildAccessSettings";

type BusyAction = "read" | "write" | string | null;

function accessError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return "RIFT Desktop could not update local access. Try again.";
}

export function useDesktopWorkspaceAccess() {
  const [desktopState, setDesktopState] =
    useState<BuildDesktopAccessState>("checking");
  const [grants, setGrants] = useState<DesktopWorkspaceGrant[]>([]);
  const [busyAction, setBusyAction] = useState<BusyAction>(null);
  const [error, setError] = useState<string | null>(null);

  const grantRevision = useRef(0);
  const refresh = useCallback(async () => {
    const revision = ++grantRevision.current;
    if (!isTauriEnvironment()) {
      setGrants([]);
      setDesktopState("unavailable");
      setError(null);
      return [];
    }

    try {
      const nextGrants = await listDesktopWorkspaceGrants();
      if (revision !== grantRevision.current) return [];
      setGrants(nextGrants);
      setDesktopState("ready");
      setError(null);
      return nextGrants;
    } catch (nextError) {
      if (revision !== grantRevision.current) return [];
      setDesktopState("error");
      setError(accessError(nextError));
      return [];
    }
  }, []);

  useEffect(() => {
    void refresh();

    const handleGrantChange = (event: Event) => {
      const detail = (event as CustomEvent<DesktopWorkspaceGrant[]>).detail;
      if (!Array.isArray(detail)) return;
      grantRevision.current += 1;
      setGrants(detail);
      setDesktopState("ready");
      setError(null);
    };

    const clearOwnerGrants = () => {
      grantRevision.current += 1;
      setGrants([]);
      setDesktopState("checking");
    };
    const refreshOwnerGrants = () => {
      void refresh();
    };
    window.addEventListener(
      DESKTOP_TERMINAL_OWNER_CHANGED_EVENT,
      clearOwnerGrants,
    );
    window.addEventListener(
      DESKTOP_TERMINAL_OWNER_READY_EVENT,
      refreshOwnerGrants,
    );
    window.addEventListener(
      DESKTOP_LOCAL_ACCESS_CHANGED_EVENT,
      handleGrantChange,
    );
    return () => {
      grantRevision.current += 1;
      window.removeEventListener(
        DESKTOP_TERMINAL_OWNER_CHANGED_EVENT,
        clearOwnerGrants,
      );
      window.removeEventListener(
        DESKTOP_TERMINAL_OWNER_READY_EVENT,
        refreshOwnerGrants,
      );
      window.removeEventListener(
        DESKTOP_LOCAL_ACCESS_CHANGED_EVENT,
        handleGrantChange,
      );
    };
  }, [refresh]);

  const requestAccess = useCallback(
    async (writable: boolean) => {
      const action = writable ? "write" : "read";
      setBusyAction(action);
      setError(null);
      try {
        const grant = await requestDesktopWorkspaceAccess({ writable });
        if (grant) await refresh();
      } catch (nextError) {
        setError(accessError(nextError));
      } finally {
        setBusyAction(null);
      }
    },
    [refresh],
  );

  const revokeAccess = useCallback(
    async (grantId: string) => {
      setBusyAction(grantId);
      setError(null);
      try {
        const revoked = await revokeDesktopWorkspaceAccess(grantId);
        if (revoked) {
          await refresh();
        } else if (isTauriEnvironment()) {
          setError("RIFT Desktop could not stop sharing this folder.");
        }
      } catch (nextError) {
        setError(accessError(nextError));
      } finally {
        setBusyAction(null);
      }
    },
    [refresh],
  );

  return {
    busyAction,
    desktopState,
    error,
    grants,
    refresh,
    requestAccess,
    revokeAccess,
  };
}
