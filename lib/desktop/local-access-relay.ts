import {
  captureRelayOrigin,
  type RelayOrigin,
} from "@/lib/centrifugo/relay-origin";
import "server-only";
import { assertLocalSandboxOnline } from "@/lib/ai/tools/utils/local-sandbox-presence";

import { Centrifuge, type Subscription } from "centrifuge";
import { api } from "@/convex/_generated/api";
import { generateCentrifugoToken } from "@/lib/centrifugo/jwt";
import {
  sandboxConnectionChannel,
  type DesktopLocalAccessOperation,
  type DesktopLocalAccessRequestMessage,
  type DesktopLocalAccessResultMessage,
} from "@/lib/centrifugo/types";

export type DesktopLocalAccessErrorCode =
  | "unavailable"
  | "denied"
  | "timeout"
  | "disconnected"
  | "outcome_unknown"
  | "aborted"
  | "invalid_response";

export class DesktopLocalAccessError extends Error {
  constructor(
    public readonly code: DesktopLocalAccessErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DesktopLocalAccessError";
  }
}

export type DesktopWorkspaceGrantResult = {
  grantId: string;
  name: string;
  rootPath?: string;
  writable: boolean;
  grantedAt: number;
  kind?: "file" | "directory";
  relativePath?: string;
};

export type DesktopWorkspaceEntryResult = {
  name: string;
  relativePath: string;
  kind: "directory" | "file" | "other";
  size: number | null;
};

export type DesktopWorkspaceFileResult = {
  relativePath: string;
  mediaType: string;
  encoding: "utf8" | "base64";
  content: string;
  size: number;
  version?: string;
};

export type DesktopLoopbackFetchResult = {
  status: number;
  finalUrl: string;
  contentType: string;
  encoding: "utf8" | "base64";
  body: string;
  bytes: number;
  truncated: boolean;
};

export interface DesktopLocalAccessRequest<T = unknown> {
  userId: string;
  serviceKey: string;
  operation: DesktopLocalAccessOperation;
  payload?: Record<string, unknown>;
  timeoutMs?: number;
  signal?: AbortSignal;
}

type DesktopConnection = {
  connectionId: string;
  lastSeen: number;
  isDesktop: boolean;
};

function parseResultMessage(
  data: unknown,
): DesktopLocalAccessResultMessage | null {
  if (!data || typeof data !== "object") return null;
  const candidate = data as Record<string, unknown>;
  if (
    candidate.type !== "desktop_local_access_result" ||
    typeof candidate.requestId !== "string" ||
    typeof candidate.ok !== "boolean"
  ) {
    return null;
  }
  if (!candidate.ok && typeof candidate.error !== "string") return null;
  return candidate as unknown as DesktopLocalAccessResultMessage;
}

async function resolveDesktopConnection(
  userId: string,
  origin: RelayOrigin,
): Promise<DesktopConnection> {
  let connections: unknown;
  try {
    connections = await origin.client!.query(
      api.localSandbox.listConnectionsForBackend,
      { serviceKey: origin.serviceKey!, userId },
    );
  } catch (error) {
    throw new DesktopLocalAccessError(
      "unavailable",
      `Could not resolve the signed-in desktop connection: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  const desktop = (connections as DesktopConnection[])
    .filter((connection) => connection.isDesktop)
    .sort((left, right) => right.lastSeen - left.lastSeen)[0];
  if (!desktop) {
    throw new DesktopLocalAccessError(
      "unavailable",
      "RIFT Desktop is not online with an active local-access session.",
    );
  }
  return desktop;
}

/**
 * Relays one narrow operation to the owner-checked RIFT Desktop connection.
 * The desktop app applies its native grant/localhost policy again before it
 * returns a bounded result; this helper never exposes a shell or host path.
 */
export async function requestDesktopLocalAccess<T = unknown>(
  {
    userId,
    serviceKey,
    operation,
    payload,
    timeoutMs = 30_000,
    signal,
  }: DesktopLocalAccessRequest<T>,
  origin = captureRelayOrigin(serviceKey),
): Promise<T> {
  if (!origin.serviceKey) {
    throw new DesktopLocalAccessError(
      "unavailable",
      "The desktop relay is not configured for this Build worker.",
    );
  }
  if (signal?.aborted) {
    throw new DesktopLocalAccessError("aborted", "Desktop access was stopped.");
  }

  if (!origin.client || !origin.wsUrl || !origin.tokenSecret) {
    throw new DesktopLocalAccessError(
      "unavailable",
      "The desktop relay is not configured for this Build worker.",
    );
  }

  const connection = await resolveDesktopConnection(userId, origin);
  if (signal?.aborted) {
    throw new DesktopLocalAccessError("aborted", "Desktop access was stopped.");
  }
  // A persisted connection row is not proof that its desktop still listens.
  // Check presence before waiting up to two minutes for a native interaction.
  try {
    await assertLocalSandboxOnline(
      userId,
      connection.connectionId,
      origin.wsUrl,
      origin,
    );
  } catch {
    throw new DesktopLocalAccessError(
      signal?.aborted ? "aborted" : "disconnected",
      "The desktop is not currently connected. No local action was sent.",
    );
  }
  if (signal?.aborted) {
    throw new DesktopLocalAccessError("aborted", "Desktop access was stopped.");
  }
  const requestId = crypto.randomUUID();
  const token = await generateCentrifugoToken(
    userId,
    Math.ceil(timeoutMs / 1000) + 30,
    origin,
  );
  if (signal?.aborted) {
    throw new DesktopLocalAccessError("aborted", "Desktop access was stopped.");
  }
  const wsUrl = origin.wsUrl;
  if (!wsUrl) {
    throw new DesktopLocalAccessError(
      "unavailable",
      "The desktop relay is not configured.",
    );
  }

  const client = new Centrifuge(wsUrl, { token });
  const channel = sandboxConnectionChannel(userId, connection.connectionId);
  let subscription: Subscription | undefined;

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let dispatched = false;
    let timeoutId: ReturnType<typeof setTimeout>;
    const cleanup = () => {
      clearTimeout(timeoutId);
      signal?.removeEventListener("abort", onAbort);
      try {
        subscription?.unsubscribe();
        subscription?.removeAllListeners();
      } catch {
        // best-effort cleanup
      }
      try {
        client.disconnect();
      } catch {
        // best-effort cleanup
      }
    };
    const fail = (error: DesktopLocalAccessError) => {
      if (settled) return;
      settled = true;
      cleanup();
      // Losing the acknowledgement cannot undo an operation already sent to
      // the desktop. Never invite a blind replay of a possibly completed write.
      const unknownOutcome =
        dispatched &&
        (operation === "write_file" ||
          operation === "open_visible_url" ||
          (operation === "computer_action" &&
            payload?.action !== "screenshot")) &&
        ["disconnected", "timeout", "aborted"].includes(error.code);
      reject(
        unknownOutcome
          ? new DesktopLocalAccessError(
              "outcome_unknown",
              "The desktop operation was sent but its outcome could not be confirmed. Check the current file or browser state before requesting another change.",
            )
          : error,
      );
    };
    const succeed = (result: T) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };
    const onAbort = () =>
      fail(
        new DesktopLocalAccessError("aborted", "Desktop access was stopped."),
      );
    timeoutId = setTimeout(
      () =>
        fail(
          new DesktopLocalAccessError(
            "timeout",
            "RIFT Desktop did not answer the local-access request in time.",
          ),
        ),
      Math.max(1_000, Math.min(timeoutMs, 120_000)),
    );
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
      return;
    }

    subscription = client.newSubscription(channel);
    subscription.on("publication", (context) => {
      const message = parseResultMessage(context.data);
      if (!message || message.requestId !== requestId) return;
      if (!message.ok) {
        fail(
          new DesktopLocalAccessError(
            "denied",
            message.error || "RIFT Desktop denied the local-access request.",
          ),
        );
        return;
      }
      succeed(message.result as T);
    });
    subscription.on("error", (context) => {
      fail(
        new DesktopLocalAccessError(
          "disconnected",
          context.error?.message || "The RIFT Desktop relay disconnected.",
        ),
      );
    });
    subscription.on("subscribed", () => {
      if (settled || dispatched) return;
      if (signal?.aborted) {
        onAbort();
        return;
      }
      const message: DesktopLocalAccessRequestMessage = {
        type: "desktop_local_access_request",
        requestId,
        operation,
        payload,
        targetConnectionId: connection.connectionId,
      };
      // A subscribe acknowledgement also fires after reconnect. It must not
      // execute the same native side effect for a second time.
      dispatched = true;
      subscription!.publish(message).catch((error: unknown) => {
        fail(
          new DesktopLocalAccessError(
            "disconnected",
            `Could not send the request to RIFT Desktop: ${
              error instanceof Error ? error.message : String(error)
            }`,
          ),
        );
      });
    });
    client.on("error", (context) => {
      fail(
        new DesktopLocalAccessError(
          "disconnected",
          context.error?.message || "The RIFT Desktop relay could not connect.",
        ),
      );
    });

    subscription.subscribe();
    client.connect();
  });
}
