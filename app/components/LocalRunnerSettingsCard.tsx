"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { Check, Copy, LoaderCircle, Terminal, Unplug } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { useGlobalState } from "@/app/contexts/GlobalState";
import { Button } from "@/components/ui/button";
import {
  buildLocalRunnerConnectCommand,
  type LocalRunnerShell,
} from "@/lib/local-runner/connect-command";

export function LocalRunnerSettingsCard() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const connections = useQuery(
    api.localSandbox.listConnections,
    isAuthenticated ? {} : "skip",
  );
  const getToken = useMutation(api.localSandbox.getToken);
  const disconnect = useMutation(api.localSandbox.disconnectDesktop);
  const { sandboxPreference, setSandboxPreference } = useGlobalState();
  const headingId = useId();
  const shellId = useId();
  const [shell, setShell] = useState<LocalRunnerShell>("posix");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const prepared = useRef<{ shell: LocalRunnerShell; command: string } | null>(
    null,
  );
  const generation = useRef(0);
  const busyRef = useRef(false);
  useEffect(() => {
    generation.current += 1;
    prepared.current = null;
    busyRef.current = false;
    setBusy(null);
    setNotice(null);
    setError(null);
    return () => {
      generation.current += 1;
      prepared.current = null;
    };
  }, [isAuthenticated]);

  const runners =
    connections?.filter(
      (entry) => entry.capabilities.commands && !entry.isDesktop,
    ) ?? [];
  const selectedRunner = runners.find(
    (entry) => entry.connectionId === sandboxPreference,
  );
  const selectedLabel =
    sandboxPreference === "e2b"
      ? "Cloud"
      : (selectedRunner?.name ?? "Unavailable local runner");

  const copyCommand = async () => {
    if (!isAuthenticated || busyRef.current) return;
    busyRef.current = true;
    const revision = generation.current;
    setBusy("copy");
    setError(null);
    setNotice(null);
    let command: string;
    try {
      // A cached command allows a fresh clipboard gesture when WKWebView blocks
      // the first write after asynchronous authentication. Never keep it in DOM.
      if (prepared.current?.shell === shell) {
        command = prepared.current.command;
      } else {
        const { token } = await getToken({});
        if (revision !== generation.current) return;
        command = buildLocalRunnerConnectCommand({
          origin: window.location.origin,
          convexUrl: process.env.NEXT_PUBLIC_CONVEX_URL ?? "",
          token,
          shell,
        });
        prepared.current = { shell, command };
      }
      try {
        await navigator.clipboard.writeText(command);
        if (revision === generation.current) {
          prepared.current = null;
          setNotice(
            "Command copied. Run it on the computer you want Build to use, then select that runner below.",
          );
        }
      } catch {
        if (revision === generation.current)
          setError(
            "Command is ready. Click Copy again to allow clipboard access.",
          );
      }
    } catch {
      if (revision === generation.current)
        setError(
          "Could not prepare the connection command. Check your connection and sign-in, then try again.",
        );
    } finally {
      if (revision === generation.current) {
        busyRef.current = false;
        setBusy(null);
      }
    }
  };

  const disconnectRunner = async (connectionId: string) => {
    if (!isAuthenticated || busyRef.current) return;
    busyRef.current = true;
    const revision = generation.current;
    setBusy(connectionId);
    setError(null);
    setNotice(null);
    try {
      const result = await disconnect({ connectionId });
      if (revision !== generation.current) return;
      if (!result.success) throw new Error("Disconnect rejected");
      setNotice(
        "Runner disconnected. An existing selection stays unchanged until you choose another target.",
      );
    } catch {
      if (revision === generation.current)
        setError(
          "Could not disconnect this runner. Check your connection and try again.",
        );
    } finally {
      if (revision === generation.current) {
        busyRef.current = false;
        setBusy(null);
      }
    }
  };

  return (
    <section
      aria-labelledby={headingId}
      className="overflow-hidden rounded-[10px] border border-border bg-surface-1 text-[length:var(--rift-type-body,13px)] leading-5"
    >
      <div className="border-b border-border px-3 py-3">
        <div className="flex items-center gap-2">
          <Terminal
            aria-hidden
            className="size-4 text-muted-foreground"
            strokeWidth={1.7}
          />
          <h3 id={headingId} className="font-medium text-foreground">
            Local runner
          </h3>
        </div>
        <p className="mt-1 text-[length:var(--rift-type-caption,12px)] leading-4 text-muted-foreground">
          Run Build commands directly on a computer you connect. The runner can
          read and change that computer’s files and run shell commands. Picker
          access below remains limited to the items you share.
        </p>
      </div>
      <div className="space-y-3 px-3 py-3">
        <p className="text-[length:var(--rift-type-caption,12px)] text-muted-foreground">
          Requires Node.js 18 or later. Paste the command into your terminal and
          keep the runner open.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor={shellId} className="sr-only">
            Terminal shell
          </label>
          <select
            id={shellId}
            value={shell}
            disabled={busy !== null}
            onChange={(event) => {
              setShell(event.target.value as LocalRunnerShell);
              prepared.current = null;
              setNotice(null);
              setError(null);
            }}
            className="h-8 rounded-md border border-border bg-background px-2 text-[length:var(--rift-type-caption,12px)] text-foreground focus-visible:outline focus-visible:outline-1 focus-visible:outline-foreground/30"
          >
            <option value="posix">macOS / Linux</option>
            <option value="powershell">Windows PowerShell</option>
          </select>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!isAuthenticated || isLoading || busy !== null}
            onClick={() => void copyCommand()}
          >
            {busy === "copy" ? (
              <LoaderCircle
                aria-hidden
                className="size-3.5 motion-safe:animate-spin"
              />
            ) : (
              <Copy aria-hidden className="size-3.5" />
            )}
            Copy connect command
          </Button>
        </div>
        <p className="text-[length:var(--rift-type-caption,12px)] text-muted-foreground">
          The command contains your private connection token. Paste it only into
          your own terminal.
        </p>
        {!isAuthenticated && !isLoading && (
          <p className="text-muted-foreground">Sign in to connect a runner.</p>
        )}
        {notice && (
          <p
            role="status"
            className="text-[length:var(--rift-type-caption,12px)] text-muted-foreground"
          >
            {notice}
          </p>
        )}
        {error && (
          <p
            role="alert"
            className="text-[length:var(--rift-type-caption,12px)] text-destructive"
          >
            {error}
          </p>
        )}
      </div>
      <div className="border-t border-border px-3 py-2.5">
        <p className="font-medium text-foreground">
          Selected target: {selectedLabel}
        </p>
        <p className="mt-0.5 text-[length:var(--rift-type-caption,12px)] leading-4 text-muted-foreground">
          Registered runners are listed below. Build checks the connection
          before starting; an unavailable runner never switches to Cloud
          automatically.
        </p>
      </div>
      {isLoading || (isAuthenticated && connections === undefined) ? (
        <p className="px-3 pb-3 text-muted-foreground">Loading runners…</p>
      ) : isAuthenticated && runners.length === 0 ? (
        <p className="px-3 pb-3 text-muted-foreground">No runners connected</p>
      ) : isAuthenticated ? (
        <ul className="divide-y divide-border/70 border-t border-border">
          {runners.map((runner) => {
            const selected = runner.connectionId === sandboxPreference;
            return (
              <li
                key={runner.connectionId}
                className="flex flex-wrap items-center gap-2 px-3 py-2.5"
              >
                <span className="min-w-0 flex-1 truncate text-foreground">
                  {runner.name}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`Use ${runner.name}`}
                  aria-pressed={selected}
                  disabled={busy !== null}
                  onClick={() => setSandboxPreference(runner.connectionId)}
                >
                  {selected && <Check aria-hidden className="size-3.5" />}
                  {selected ? "Selected" : "Use for Build"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`Disconnect ${runner.name}`}
                  disabled={busy !== null}
                  onClick={() => void disconnectRunner(runner.connectionId)}
                >
                  {busy === runner.connectionId ? (
                    <LoaderCircle
                      aria-hidden
                      className="size-3.5 motion-safe:animate-spin"
                    />
                  ) : (
                    <Unplug aria-hidden className="size-3.5" />
                  )}
                  Disconnect
                </Button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
