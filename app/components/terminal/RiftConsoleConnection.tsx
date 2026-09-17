"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { useRiftConsoleRuntime } from "./useRiftConsoleRuntime";
import {
  parseConsolePairing,
  withoutConsolePairing,
  type ConsolePairing,
} from "@/lib/console/pairing";
import {
  CONSOLE_PROTOCOL,
  CONSOLE_SOCKET_PATH,
  CONSOLE_MAX_MESSAGE_BYTES,
  isConsoleServerMessage,
  type ConsoleAppMessage,
} from "@/packages/console/src/protocol";
import styles from "./RiftConsoleConnection.module.css";
import { encodeConsoleSnapshot } from "@/lib/console/wire-snapshot";

/** Explicit pairing shares only the active chat; no app credentials leave RIFT. */
export function RiftConsoleConnection() {
  const runtime = useRiftConsoleRuntime();
  const latest = useRef(runtime);
  const socketRef = useRef<WebSocket | null>(null);
  const acknowledged = useRef(false);
  const [offer, setOffer] = useState<ConsolePairing | null>(null);
  const [pairing, setPairing] = useState<ConsolePairing | null>(null);
  const [connection, setConnection] = useState("Connecting");
  const [attempt, setAttempt] = useState(0);

  useLayoutEffect(() => {
    latest.current = runtime;
  });
  useEffect(() => {
    let frame = 0;
    const inspect = () => {
      const value = parseConsolePairing(window.location.hash);
      if (!value) return;
      // Drop the one-time capability from browser history before displaying it.
      window.history.replaceState(
        window.history.state,
        "",
        `${window.location.pathname}${window.location.search}${withoutConsolePairing(window.location.hash)}`,
      );
      frame = requestAnimationFrame(() => setOffer(value));
    };
    inspect();
    window.addEventListener("hashchange", inspect);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("hashchange", inspect);
    };
  }, []);

  useEffect(() => {
    if (!pairing) return;
    let disposed = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let retries = 0;
    let sequence = Promise.resolve();
    const results = new Map<string, ConsoleAppMessage>();
    const pending = new Set<string>();
    const send = (socket: WebSocket, message: ConsoleAppMessage) => {
      if (socket.readyState !== WebSocket.OPEN) return;
      const json =
        message.type === "snapshot"
          ? encodeConsoleSnapshot(message.snapshot)
          : JSON.stringify(message);
      if (new TextEncoder().encode(json).byteLength > CONSOLE_MAX_MESSAGE_BYTES)
        return;
      socket.send(json);
    };
    function connect() {
      if (disposed) return;
      acknowledged.current = false;
      let socket: WebSocket;
      try {
        socket = new WebSocket(
          `ws://127.0.0.1:${pairing!.port}${CONSOLE_SOCKET_PATH}`,
          [CONSOLE_PROTOCOL, `rift-${pairing!.token}`],
        );
      } catch {
        setConnection("Disconnected");
        return;
      }
      socketRef.current = socket;
      socket.onmessage = (event) => {
        if (
          disposed ||
          socket !== socketRef.current ||
          typeof event.data !== "string" ||
          event.data.length > CONSOLE_MAX_MESSAGE_BYTES
        )
          return;
        let message: unknown;
        try {
          message = JSON.parse(event.data);
        } catch {
          return;
        }
        if (!isConsoleServerMessage(message)) return;
        if (message.type === "connected") {
          acknowledged.current = true;
          retries = 0;
          setConnection("Connected");
          send(socket, { type: "snapshot", snapshot: latest.current.snapshot });
          return;
        }
        if (!acknowledged.current) return;
        const { id, command } = message;
        const cached = results.get(id);
        if (cached) {
          send(socket, cached);
          return;
        }
        if (pending.has(id)) return;
        pending.add(id);
        sequence = sequence
          .then(async () => {
            // A disconnected command must never begin on a later connection.
            if (
              disposed ||
              socket !== socketRef.current ||
              socket.readyState !== WebSocket.OPEN
            ) {
              pending.delete(id);
              return;
            }
            const result = await latest.current.onCommand(command);
            const response: ConsoleAppMessage = {
              type: "result",
              id,
              ...result,
            };
            results.set(id, response);
            pending.delete(id);
            if (results.size > 256)
              results.delete(results.keys().next().value!);
            send(socket, response);
            // Allow shared settings to commit before the next command uses them.
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
          })
          .catch(() => {
            pending.delete(id);
            const response: ConsoleAppMessage = {
              type: "result",
              id,
              accepted: false,
              error:
                "Action outcome unavailable. Check the app before retrying.",
            };
            results.set(id, response);
            if (results.size > 256)
              results.delete(results.keys().next().value!);
            send(socket, response);
          });
      };
      socket.onerror = () => {
        /* onclose provides one consistent recovery path. */
      };
      socket.onclose = () => {
        if (disposed || socket !== socketRef.current) return;
        acknowledged.current = false;
        if (retries >= 5) {
          setConnection("Disconnected");
          return;
        }
        setConnection("Reconnecting");
        retryTimer = setTimeout(connect, Math.min(500 * 2 ** retries++, 5000));
      };
    }
    // Keep effect state changes asynchronous; the request originated in pairing.
    retryTimer = setTimeout(connect, 0);
    return () => {
      disposed = true;
      clearTimeout(retryTimer);
      acknowledged.current = false;
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [pairing, attempt]);

  useEffect(() => {
    const socket = socketRef.current;
    if (
      !socket ||
      socket.readyState !== WebSocket.OPEN ||
      !acknowledged.current
    )
      return;
    // Coalesce stream bursts. Always send an authoritative snapshot after reconnect.
    const timer = setTimeout(() => {
      if (socket !== socketRef.current || socket.readyState !== WebSocket.OPEN)
        return;
      const json = encodeConsoleSnapshot(runtime.snapshot);
      if (
        new TextEncoder().encode(json).byteLength <= CONSOLE_MAX_MESSAGE_BYTES
      )
        socket.send(json);
    }, 60);
    return () => clearTimeout(timer);
  }, [runtime.snapshot]);

  return (
    <>
      <AlertDialog.Root
        open={!!offer}
        onOpenChange={(open) => {
          if (!open) setOffer(null);
        }}
      >
        <AlertDialog.Portal>
          <AlertDialog.Overlay className={styles.overlay} />
          <AlertDialog.Content className={styles.dialog}>
            <AlertDialog.Title className={styles.title}>
              Connect RIFT console?
            </AlertDialog.Title>
            <AlertDialog.Description className={styles.description}>
              The terminal on this computer can read your active Build chat and
              send tasks using its model, computer and permissions. Keep this
              window open while you work in the console.
            </AlertDialog.Description>
            <p className={styles.address}>
              Local connection · 127.0.0.1:{offer?.port}
            </p>
            <div className={styles.actions}>
              <AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
              <AlertDialog.Action
                onClick={() => {
                  setPairing(offer);
                  setConnection("Connecting");
                  setOffer(null);
                }}
              >
                Connect console
              </AlertDialog.Action>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
      {pairing && (
        <aside className={styles.status} aria-label="RIFT console connection">
          <span role="status">Console · {connection.toLowerCase()}</span>
          {connection === "Disconnected" && (
            <button
              onClick={() => {
                setConnection("Connecting");
                setAttempt((a) => a + 1);
              }}
            >
              Reconnect
            </button>
          )}
          <button onClick={() => setPairing(null)}>Disconnect</button>
        </aside>
      )}
    </>
  );
}
