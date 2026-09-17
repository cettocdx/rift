"use client";

import { useEffect, useState } from "react";

type HealthStatus =
  | "checking"
  | "running"
  | "stopped"
  | "missing"
  | "paused"
  | "transient"
  | "stale"
  | "unavailable"
  | "unsupported";
type Health = {
  status: HealthStatus;
  url?: string;
  revalidationFailed?: boolean;
};
const statuses = new Set([
  "running",
  "stopped",
  "missing",
  "paused",
  "transient",
  "stale",
  "unavailable",
  "unsupported",
]);
function isWebUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    return ["https:", "http:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

/** Saved URLs identify a preview; only a current server check authorizes loading it. */
export function useBuildPreviewHealth(
  chatId: string | undefined,
  previewUrl: string | null,
  active: boolean,
) {
  const [request, setRequest] = useState({
    attempt: 0,
    resume: false,
    identity: "",
  });
  const identity = JSON.stringify([chatId, previewUrl]);
  if (request.resume && (!active || request.identity !== identity)) {
    setRequest((value) => ({ ...value, resume: false }));
  }
  const resuming = active && request.resume && request.identity === identity;
  const attempt = request.attempt;
  const [result, setResult] = useState<{ key: string; health: Health } | null>(
    null,
  );
  const validIdentity = Boolean(chatId?.trim()) && isWebUrl(previewUrl);
  const eligible = active && validIdentity;
  const key = identity;
  // Identity changes must discard the previous result.
  // Visibility only pauses checks: retain the already-mounted browser while
  // revalidating on return, rather than destroying its navigation/form state.
  // Transient observation failures do not prove that an open app stopped.
  // Authoritative stop/access failures remove it; no new identity reuses it.
  const [observedKey, setObservedKey] = useState(key);
  if (observedKey !== key) {
    setObservedKey(key);
    setResult(null);
  }
  useEffect(() => {
    if (!eligible) return;
    const controller = new AbortController();
    let settled = false;
    const finish = (health: Health) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      setResult((previous) => {
        if (
          health.status === "transient" &&
          previous?.key === key &&
          (previous.health.status === "running" ||
            previous.health.status === "unsupported")
        ) {
          return {
            key,
            health: { ...previous.health, revalidationFailed: true },
          };
        }
        return { key, health };
      });
    };
    const timer = setTimeout(
      () => {
        finish({ status: "transient" });
        controller.abort();
      },
      resuming ? 25_000 : 12_000,
    );
    void (async () => {
      try {
        const response = await fetch(
          resuming
            ? "/api/preview/resume"
            : `/api/preview/status?${new URLSearchParams({ chatId: chatId!, previewUrl: previewUrl! })}`,
          {
            signal: controller.signal,
            cache: "no-store",
            ...(resuming
              ? {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ chatId, previewUrl }),
                }
              : {}),
          },
        );
        if (!response.ok) {
          finish({
            status: response.status >= 500 ? "transient" : "unavailable",
          });
          return;
        }
        const data = await response.json();
        if (data.chatId === chatId && data.status === "stale") {
          finish({ status: "stale" });
          return;
        }
        if (
          data.chatId !== chatId ||
          data.previewUrl !== previewUrl ||
          !statuses.has(data.status)
        ) {
          finish({ status: "unavailable" });
          return;
        }
        if (data.status === "unsupported") {
          finish({ status: "unsupported", url: previewUrl! });
          return;
        }
        finish(
          data.status === "running"
            ? isWebUrl(data.url)
              ? { status: "running", url: data.url }
              : { status: "unavailable" }
            : { status: data.status },
        );
      } catch {
        finish({ status: "transient" });
      }
    })();
    return () => {
      settled = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [chatId, previewUrl, eligible, key, resuming, attempt]);
  const health: Health = !validIdentity
    ? { status: "unavailable" }
    : result?.key === key
      ? result.health
      : { status: active ? "checking" : "unavailable" };
  const submit = (resume: boolean) => {
    if (!eligible) return;
    // Retain a verified iframe during a read-only retry. Unverified states
    // still show checking; resuming a paused environment keeps its own flow.
    setResult((previous) =>
      previous?.key === key &&
      (previous.health.status === "running" ||
        previous.health.status === "unsupported")
        ? previous
        : null,
    );
    setRequest((value) => ({ attempt: value.attempt + 1, resume, identity }));
  };
  return {
    ...health,
    resuming: resuming && health.status === "checking",
    retry: () => submit(false),
    resume: () => submit(true),
  };
}
