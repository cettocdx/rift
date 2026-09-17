"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  getDesktopNativeConsole,
  disconnectDesktopNativeConsole,
} from "@/app/services/desktop-native-console";
import { DESKTOP_TERMINAL_OWNER_CHANGED_EVENT } from "@/app/services/desktop-terminal-owner";
import {
  nativeSnapshot,
  type NativeConsoleClient,
} from "@/packages/console/src/native-client";
import type { ConsoleCommand } from "@/packages/console/src/protocol";
export function useNativeConsoleRuntime(grantId: string | null) {
  const epoch = useRef(0);
  const unsubscribe = useRef<(() => void) | undefined>(undefined);
  const [boundEpoch, setBoundEpoch] = useState(-1);
  const [client, setClient] = useState<NativeConsoleClient | null>(null);
  const [snapshot, setSnapshot] = useState(() => nativeSnapshot());
  const [revision, setRevision] = useState(0);
  const [ownerRevision, setOwnerRevision] = useState(0);
  useEffect(() => {
    const clear = () => {
      epoch.current += 1;
      setOwnerRevision((value) => value + 1);
      unsubscribe.current?.();
      unsubscribe.current = undefined;
      setClient(null);
      setSnapshot(
        nativeSnapshot(
          "Sign in and choose a writable folder to use the native console.",
        ),
      );
    };
    window.addEventListener(DESKTOP_TERMINAL_OWNER_CHANGED_EVENT, clear);
    return () =>
      window.removeEventListener(DESKTOP_TERMINAL_OWNER_CHANGED_EVENT, clear);
  }, []);
  useEffect(() => {
    const openingEpoch = ++epoch.current;
    unsubscribe.current?.();
    unsubscribe.current = undefined;
    // Reset the external connection subscription when its workspace changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setClient(null);
    setSnapshot(
      nativeSnapshot(grantId ? "Connecting to native console…" : undefined),
    );
    if (grantId)
      void getDesktopNativeConsole(grantId).then(
        (next) => {
          if (epoch.current !== openingEpoch) return;
          setBoundEpoch(openingEpoch);
          setClient(next);
          setSnapshot(next.snapshot);
          unsubscribe.current = next.subscribe(() => {
            if (epoch.current === openingEpoch) setSnapshot(next.snapshot);
          });
        },
        (error) => {
          if (epoch.current === openingEpoch)
            setSnapshot(
              nativeSnapshot(
                error instanceof Error ? error.message : String(error),
              ),
            );
        },
      );
    return () => {
      if (epoch.current === openingEpoch) epoch.current += 1;
      unsubscribe.current?.();
      unsubscribe.current = undefined;
    };
  }, [grantId, revision]);
  const onCommand = useCallback(
    (command: ConsoleCommand) =>
      client && boundEpoch === epoch.current
        ? client.command(command)
        : Promise.resolve({
            accepted: false,
            error:
              "Native console is unavailable. Sign in, choose a writable folder, and check native setup.",
          }),
    [client, boundEpoch],
  );
  const disconnect = async () => {
    if (!grantId) return;
    const disconnectEpoch = epoch.current;
    try {
      await disconnectDesktopNativeConsole(grantId);
      if (epoch.current !== disconnectEpoch) return;
      epoch.current += 1;
      unsubscribe.current?.();
      unsubscribe.current = undefined;
      setClient(null);
      setSnapshot(
        nativeSnapshot(
          "Disconnected. Saved history is retained. Reconnect to resume the conversation. Previous input will not be resent.",
        ),
      );
    } catch (error) {
      if (epoch.current !== disconnectEpoch) return;
      setSnapshot(
        nativeSnapshot(error instanceof Error ? error.message : String(error)),
      );
    }
  };
  return {
    snapshot,
    ownerRevision,
    onCommand,
    disconnect,
    reconnect: () => setRevision((r) => r + 1),
  };
}
