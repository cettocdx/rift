"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { ConvexError } from "convex/values";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { isTauriEnvironment, openInBrowser } from "@/app/hooks/useTauri";
import { Loader2, Check, X, Unplug } from "lucide-react";

import { OAUTH_RESULT_MESSAGES } from "@/lib/github/oauth-result-messages";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { observeChatViewport } from "./chat-layout/ChatViewport";

export const GithubMark = ({ className }: { className?: string }) => (
  <svg
    viewBox="0 0 24 24"
    fill="currentColor"
    className={className}
    aria-hidden
  >
    <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
  </svg>
);

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ConvexError) {
    const data = error.data as { message?: string } | string | undefined;
    if (typeof data === "string") return data;
    if (data?.message) return data.message;
  }
  if (error instanceof Error) return error.message;
  return fallback;
}

/**
 * "Connect GitHub" control — stores a personal access token so the Build agent
 * and the Terminal can clone/push the user's repos. Shown in the Build composer
 * and the Terminal header. `variant` picks the trigger sizing.
 */
export function GithubConnectButton({
  variant = "pill",
}: {
  variant?: "pill" | "button" | "sidebar";
}) {
  const status = useQuery(api.github.getStatus, {});
  const connect = useMutation(api.github.connect);
  const disconnect = useMutation(api.github.disconnect);

  const [open, setOpen] = useState(false);
  const [token, setToken] = useState("");
  const [pending, setPending] = useState<
    "oauth" | "token" | "disconnect" | null
  >(null);
  const [error, setError] = useState("");
  const [waitingForConnection, setWaitingForConnection] = useState(false);
  const request = useRef<AbortController | null>(null);
  const connectedAtOAuthStart = useRef(false);
  const busy = pending !== null;
  // Manual-token entry is a de-emphasised fallback: OAuth ("Continue with
  // GitHub") is the primary path, so users are never forced to paste a key.
  const [showToken, setShowToken] = useState(false);
  const attachDialog = useCallback((node: HTMLDivElement | null) => {
    if (node) return observeChatViewport(node);
  }, []);

  const connected = status?.connected ?? false;
  const username = status?.username;

  const closeDialog = useCallback(() => {
    request.current?.abort();
    request.current = null;
    setPending(null);
    setWaitingForConnection(false);
    setOpen(false);
  }, []);

  useEffect(() => () => request.current?.abort(), []);

  useEffect(() => {
    if (connected && waitingForConnection && !connectedAtOAuthStart.current)
      closeDialog();
  }, [connected, waitingForConnection, closeDialog]);

  // Consume the result from the current URL before notifying. Other mounted
  // controls then see no result, while a later OAuth return can still be handled.
  useEffect(() => {
    const handleResult = () => {
      const params = new URLSearchParams(window.location.search);
      const result = params.get("github");
      // Plugin returns belong to the Plugins page, including its inline recovery.
      if (!result || params.get("connect") === "github") return;
      params.delete("github");
      const qs = params.toString();
      window.history.replaceState(
        window.history.state,
        "",
        window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash,
      );
      const entry = OAUTH_RESULT_MESSAGES[result];
      if (!entry) return;
      if (entry.kind === "success") {
        closeDialog();
        toast.success(entry.message);
      } else {
        setWaitingForConnection(false);
        toast.error(entry.message);
        setError(entry.message);
        setOpen(true);
      }
    };
    handleResult();
    window.addEventListener("popstate", handleResult);
    return () => window.removeEventListener("popstate", handleResult);
  }, [closeDialog]);

  const beginRequest = (kind: "oauth" | "token" | "disconnect") => {
    if (request.current) return null;
    const controller = new AbortController();
    request.current = controller;
    setPending(kind);
    setError("");
    setWaitingForConnection(false);
    return controller;
  };

  const finishRequest = (controller: AbortController) => {
    if (request.current !== controller) return;
    request.current = null;
    setPending(null);
  };

  const startOAuth = async () => {
    const controller = beginRequest("oauth");
    if (!controller) return;
    connectedAtOAuthStart.current = connected;
    let timedOut = false;
    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 15_000);
    try {
      const desktop = isTauriEnvironment();
      const body: {
        return_to: string;
        desktop_state?: string;
        desktop_scheme?: string;
      } = {
        return_to: window.location.pathname + window.location.search,
      };
      if (desktop) {
        const { invoke } = await import("@tauri-apps/api/core");
        body.desktop_state = await invoke<string>("prepare_desktop_auth_state");
        body.desktop_scheme = await invoke<string>(
          "github_desktop_callback_scheme",
        );
      }
      controller.signal.throwIfAborted();
      const response = await fetch("/api/github/authorize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(
          typeof data.error === "string"
            ? data.error
            : OAUTH_RESULT_MESSAGES[data.code]?.message ||
                "Could not start GitHub connection. Try again.",
        );
      controller.signal.throwIfAborted();
      let url: URL;
      try {
        url = new URL(data.url);
      } catch {
        throw new Error("Invalid GitHub authorization address.");
      }
      if (
        url.origin !== "https://github.com" ||
        url.pathname !== "/login/oauth/authorize" ||
        url.username ||
        url.password
      ) {
        throw new Error("Invalid GitHub authorization address.");
      }
      if (desktop) {
        if (!(await openInBrowser(url.href)))
          throw new Error("Could not open your browser. Try again.");
        controller.signal.throwIfAborted();
        setWaitingForConnection(true);
      } else {
        window.location.assign(url.href);
      }
    } catch (cause) {
      if (!controller.signal.aborted || timedOut)
        setError(
          timedOut
            ? "GitHub connection timed out. Try again."
            : errorMessage(cause, "Could not connect GitHub. Try again."),
        );
    } finally {
      window.clearTimeout(timeout);
      finishRequest(controller);
    }
  };

  const handleTriggerClick = () => {
    setError("");
    setOpen(true);
  };

  const handleConnect = async () => {
    const verifiedToken = token.trim();
    if (!verifiedToken) return;
    const controller = beginRequest("token");
    if (!controller) return;
    let timedOut = false;
    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 15_000);
    try {
      // Do not save an unverified token: GitHub must accept it and identify
      // its account before the connection mutation runs.
      let response: Response;
      try {
        response = await fetch("https://api.github.com/user", {
          headers: {
            Authorization: `Bearer ${verifiedToken}`,
            Accept: "application/vnd.github+json",
          },
          cache: "no-store",
          redirect: "error",
          signal: controller.signal,
        });
      } catch {
        throw new Error("Could not verify your token with GitHub. Try again.");
      }
      if (response.status === 401)
        throw new Error("That token was rejected by GitHub.");
      if (response.status === 403)
        throw new Error(
          "GitHub could not verify this token. Check its permissions and try again.",
        );
      if (!response.ok)
        throw new Error("Could not verify your token with GitHub. Try again.");
      const data = await response.json();
      const login = typeof data.login === "string" ? data.login.trim() : "";
      if (!login)
        throw new Error("GitHub did not return an account for this token.");
      controller.signal.throwIfAborted();
      window.clearTimeout(timeout);
      const result = await connect({ token: verifiedToken, username: login });
      controller.signal.throwIfAborted();
      if (!result.success)
        throw new Error(
          result.error || "Could not save the GitHub connection. Try again.",
        );
      toast.success(`Connected as ${login}`);
      setToken("");
      closeDialog();
    } catch (cause) {
      if (!controller.signal.aborted || timedOut)
        setError(
          timedOut
            ? "GitHub token verification timed out. Try again."
            : errorMessage(cause, "Could not connect GitHub. Try again."),
        );
    } finally {
      window.clearTimeout(timeout);
      finishRequest(controller);
    }
  };

  const handleDisconnect = async () => {
    const controller = beginRequest("disconnect");
    if (!controller) return;
    try {
      await disconnect({});
      controller.signal.throwIfAborted();
      toast.success("GitHub disconnected");
      closeDialog();
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(errorMessage(cause, "Failed to disconnect"));
    } finally {
      finishRequest(controller);
    }
  };

  const label = connected ? username || "GitHub" : "Connect GitHub";

  const trigger =
    variant === "sidebar" ? (
      <button
        type="button"
        onClick={handleTriggerClick}
        disabled={busy}
        aria-label={connected ? "Manage GitHub connection" : "Connect GitHub"}
        className="my-1 flex h-8 w-full items-center justify-center gap-2 rounded-md border border-border bg-background/50 px-3 text-[12px] font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 [@media(pointer:coarse)]:h-11"
      >
        {busy && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
        {connected ? "Manage connection" : "Connect"}
      </button>
    ) : variant === "pill" ? (
      <button
        type="button"
        onClick={handleTriggerClick}
        disabled={busy}
        title={connected ? `GitHub connected (${label})` : "Connect GitHub"}
        className="inline-flex h-6 items-center gap-1.5 rounded-md px-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <GithubMark className="size-3.5" />
        <span className="max-w-[8rem] truncate">{label}</span>
        {connected && <span className="size-1.5 rounded-full bg-emerald-500" />}
      </button>
    ) : (
      <button
        type="button"
        onClick={handleTriggerClick}
        disabled={busy}
        className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <GithubMark className="size-3.5" />
        {label}
        {connected && <span className="size-1.5 rounded-full bg-emerald-500" />}
      </button>
    );

  return (
    <>
      {trigger}
      <Dialog
        open={open}
        onOpenChange={(nextOpen) => !nextOpen && closeDialog()}
      >
        <DialogContent
          ref={attachDialog}
          className="flex flex-col gap-4 overflow-y-auto overscroll-contain sm:max-w-[460px]"
          style={{
            top: "calc(var(--rift-chat-viewport-offset, 0px) + var(--rift-chat-viewport-height, 100%) / 2)",
            maxHeight: "calc(var(--rift-chat-viewport-height, 100dvh) - 2rem)",
          }}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-[15px]">
              <GithubMark className="size-4" />
              {connected ? "GitHub" : "Connect GitHub"}
            </DialogTitle>
            <DialogDescription className="text-[12.5px]">
              {connected
                ? `Connected${username ? ` as ${username}` : ""}. RIFT can clone & push your repos in Build and the Terminal.`
                : "Authorize RIFT on GitHub — no token needed. RIFT can then clone & push your repos in Build and the Terminal."}
            </DialogDescription>
          </DialogHeader>

          {error && (
            <p
              role="alert"
              className="break-words text-[12.5px] text-destructive"
            >
              {error}
            </p>
          )}

          {waitingForConnection && (
            <p
              role="status"
              className="text-center text-[12px] text-muted-foreground"
            >
              Finish connecting in your browser. This dialog will close when
              GitHub is connected.
            </p>
          )}

          {connected ? (
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-[13px] text-emerald-500">
                  <Check className="size-4" />
                  Connected{username ? ` as ${username}` : ""}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleDisconnect}
                  disabled={busy}
                  className="h-8 gap-1.5 text-[12.5px] text-muted-foreground hover:text-foreground"
                >
                  {busy ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Unplug className="size-3.5" />
                  )}
                  Disconnect
                </Button>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={startOAuth}
                className="h-10 w-full gap-2 text-[13px] [@media(pointer:coarse)]:min-h-11"
              >
                {pending === "oauth" ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <GithubMark className="size-4" />
                )}
                Reconnect GitHub
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {/* Read the server configuration before leaving RIFT. */}
              <Button
                type="button"
                size="sm"
                disabled={busy}
                onClick={startOAuth}
                className="h-10 w-full gap-2 text-[13px] [@media(pointer:coarse)]:min-h-11"
              >
                {pending === "oauth" ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <GithubMark className="size-4" />
                )}
                Continue with GitHub
              </Button>

              <p className="text-center text-[11px] leading-relaxed text-muted-foreground/80">
                You&apos;ll be sent to GitHub to authorize RIFT, then brought
                right back. No token to copy or paste.
              </p>

              {/* De-emphasised fallback for users who prefer a PAT. */}
              <button
                type="button"
                disabled={busy}
                aria-expanded={showToken}
                onClick={() => setShowToken((v) => !v)}
                className="self-center text-[11px] text-muted-foreground/70 underline-offset-2 transition-colors hover:text-foreground hover:underline disabled:opacity-50 [@media(pointer:coarse)]:min-h-11"
              >
                {showToken
                  ? "Hide advanced"
                  : "Advanced: use a personal access token"}
              </button>

              {showToken && (
                <div className="flex flex-col gap-2.5 border-t border-border pt-3">
                  <Input
                    aria-label="Personal access token"
                    autoComplete="off"
                    disabled={busy}
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    placeholder="ghp_… or a fine-grained token"
                    type="password"
                    spellCheck={false}
                    className="h-9 text-[13px] [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:text-[16px]"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void handleConnect();
                      }
                    }}
                    autoFocus
                  />
                  <p className="text-[11px] leading-relaxed text-muted-foreground/80">
                    Create one at{" "}
                    <span className="rounded bg-muted px-1 py-0.5">
                      github.com/settings/tokens
                    </span>{" "}
                    with <code>repo</code> scope (or fine-grained repo access).
                  </p>
                  <div className="mt-1 flex justify-end gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      type="button"
                      onClick={closeDialog}
                      className="h-9 gap-1.5 text-[13px]"
                    >
                      <X className="size-3.5" />
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      type="button"
                      onClick={handleConnect}
                      disabled={!token.trim() || busy}
                      className="h-9 gap-1.5 text-[13px]"
                    >
                      {busy ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <GithubMark className="size-3.5" />
                      )}
                      Connect
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
