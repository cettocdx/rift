"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { SandboxPreference } from "@/types/chat";
import { isTauriEnvironment } from "@/app/hooks/useTauri";
import { synchronizeDesktopTerminalOwner } from "@/app/services/desktop-terminal-owner";
import { DesktopSandboxBridge } from "@/app/services/desktop-sandbox-bridge";
import {
  DESKTOP_LOCAL_ACCESS_CHANGED_EVENT,
  disconnectDesktopCapabilities,
} from "@/app/services/desktop-local-access";

interface SandboxPreferenceState {
  sandboxPreference: SandboxPreference;
  setSandboxPreference: (preference: SandboxPreference) => void;
  desktopBridgeActive: boolean;
}

export function useSandboxPreference(
  isAuthenticated: boolean,
  authReady = true,
  desktopOwnerId?: string,
): SandboxPreferenceState {
  const connectDesktop = useMutation(api.localSandbox.connectDesktop);
  const refreshDesktop = useMutation(
    api.localSandbox.refreshCentrifugoTokenDesktop,
  );
  const disconnectDesktop = useMutation(api.localSandbox.disconnectDesktop);
  const bridgeRef = useRef<DesktopSandboxBridge | null>(null);
  const [desktopBridgeActive, setDesktopBridgeActive] = useState(false);
  const [sandboxPreference, setPreference] = useState<SandboxPreference>("e2b");

  const setSandboxPreference = useCallback((preference: SandboxPreference) => {
    // Preserve the user's execution target. An unavailable Local target must
    // be reported as unavailable, never silently converted into Cloud work.
    setPreference(preference);
  }, []);

  useEffect(() => {
    setDesktopBridgeActive(false);
    if (!isTauriEnvironment()) return;
    // A missing viewer during auth hydration is not a sign-out. Native grants
    // and their terminals survive a signed-in webview reload until auth resolves.
    if (!authReady) return;
    if (!isAuthenticated) {
      void disconnectDesktopCapabilities().catch(() => {});
      return;
    }
    // Account identity is stable through renderer reload. Native synchronization
    // revokes the old process namespace on a resolved account switch.
    if (desktopOwnerId)
      void synchronizeDesktopTerminalOwner(desktopOwnerId).catch(() => {});
    let disposed = false;
    let reconcileVersion = 0;
    let startingBridge: DesktopSandboxBridge | null = null;

    const stopBridge = async () => {
      const bridge = bridgeRef.current;
      bridgeRef.current = null;
      if (!disposed) {
        setDesktopBridgeActive(false);
      }
      if (bridge) await bridge.stop();
    };

    const reconcile = async (retryDisconnected = false) => {
      const version = ++reconcileVersion;
      // Resolve account ownership before advertising a replacement agent bridge.
      try {
        if (desktopOwnerId)
          await synchronizeDesktopTerminalOwner(desktopOwnerId);
      } catch {
        return;
      }
      // Presence advertises this signed-in device, not permission to use it.
      // Native workspace/device grants still gate every operation independently.
      if (disposed) return;
      const current = bridgeRef.current;
      if (current) {
        if (
          !retryDisconnected ||
          current.isReady() ||
          startingBridge === current ||
          !current.canReconnect()
        )
          return;
        if (current.getConnectionId() !== null) {
          // A message-size close is terminal in Centrifuge. Recover its
          // existing registration; leave ordinary socket retries untouched.
          current.reconnectTransport();
          return;
        }
        await stopBridge();
        if (disposed || version !== reconcileVersion) return;
      }

      const bridge = new DesktopSandboxBridge({
        connectDesktop,
        refreshCentrifugoTokenDesktop: refreshDesktop,
        disconnectDesktop,
        onConnectionStateChange: (ready) => {
          if (disposed || bridgeRef.current !== bridge) return;
          setDesktopBridgeActive(ready);
        },
      });
      // Publish ownership before start resolves so sign-out can stop an
      // in-flight registration, not only an already connected socket.
      bridgeRef.current = bridge;
      startingBridge = bridge;
      try {
        await bridge.start();
        if (disposed || bridgeRef.current !== bridge) {
          await bridge.stop();
          return;
        }
      } catch (error) {
        if (!disposed && bridgeRef.current === bridge) {
          console.error("[desktop-local-access] relay start failed", error);
          await stopBridge();
        }
      } finally {
        if (startingBridge === bridge) startingBridge = null;
      }
    };

    void reconcile();
    const onGrantChange = () => void reconcile(true);
    const onRecovery = () => {
      if (navigator.onLine) void reconcile(true);
    };
    window.addEventListener(DESKTOP_LOCAL_ACCESS_CHANGED_EVENT, onGrantChange);
    window.addEventListener("online", onRecovery);
    window.addEventListener("focus", onRecovery);
    document.addEventListener("visibilitychange", onRecovery);
    // Token refresh can report a presence-swept session after the initial
    // wake event. Recover in background too; live reconnecting sockets retain
    // ownership and are left to Centrifuge's own retry loop.
    const recoveryTimer = window.setInterval(onRecovery, 30_000);
    return () => {
      disposed = true;
      reconcileVersion += 1;
      const bridge = bridgeRef.current;
      bridgeRef.current = null;
      window.removeEventListener(
        DESKTOP_LOCAL_ACCESS_CHANGED_EVENT,
        onGrantChange,
      );
      window.removeEventListener("online", onRecovery);
      window.removeEventListener("focus", onRecovery);
      document.removeEventListener("visibilitychange", onRecovery);
      window.clearInterval(recoveryTimer);
      void bridge?.stop();
    };
  }, [
    authReady,
    desktopOwnerId,
    connectDesktop,
    disconnectDesktop,
    isAuthenticated,
    refreshDesktop,
  ]);

  return {
    sandboxPreference,
    setSandboxPreference,
    desktopBridgeActive,
  };
}
