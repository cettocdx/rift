import { isPostHogClientFlushing } from "./client-flush";
import { recordTelemetryLoss } from "./delivery-stats";
import {
  getTelemetryContext,
  getScopedTelemetryContext,
  type TelemetryContext,
} from "./context";
import PostHogClient from "@/app/posthog";
import { emitPostHogLog, flushPostHogLogs } from "@/lib/posthog/logs";
import type { PostHog } from "posthog-node";

const clients = new WeakMap<TelemetryContext, PostHog | null>();
// Keep pending SDK clients reachable until flush, but bound destinations just
// like the OTLP exporter. Keys/configuration are never serialized into events.
const pendingClients = new Map<PostHog, number>();
const CLIENT_ORIGIN_LIMIT = 32;
let captureRevision = 0;

function admitPendingClient(): boolean {
  if (pendingClients.size < CLIENT_ORIGIN_LIMIT) return true;
  for (const client of pendingClients.keys()) {
    if (isPostHogClientFlushing(client)) continue;
    pendingClients.delete(client);
    recordTelemetryLoss("retiredAnalyticsClients");
    return true;
  }
  recordTelemetryLoss("rejectedAnalyticsEvents");
  return false;
}

function getClient(): PostHog | null {
  const context = getTelemetryContext();
  if (!context.analyticsKey) return null;
  if (!clients.has(context)) {
    if (!admitPendingClient()) return null;
    clients.set(context, PostHogClient(context));
  }
  const client = clients.get(context);
  if (!client) return null;
  if (!pendingClients.has(client) && !admitPendingClient()) return null;
  pendingClients.set(client, captureRevision++);
  return client;
}

async function flushClients(): Promise<void> {
  const scoped = getScopedTelemetryContext();
  const scopedClient = scoped ? clients.get(scoped) : undefined;
  const entries = scoped
    ? scopedClient && pendingClients.has(scopedClient)
      ? [[scopedClient, pendingClients.get(scopedClient)!] as const]
      : []
    : [...pendingClients.entries()];
  await Promise.allSettled(
    entries.map(async ([client, revision]) => {
      await client.flush();
      // Captures arriving during a flush still need a later flush.
      if (pendingClients.get(client) === revision)
        pendingClients.delete(client);
    }),
  );
}

type LogFields = Record<string, unknown> & {
  userId?: string;
  error?: unknown;
};

type EventFields = Record<string, unknown> & {
  userId?: string;
  $set?: Record<string, unknown>;
};

const TELEMETRY_STRING_MAX_LENGTH = 2_000;

function distinctIdFor(userId: unknown): string {
  return typeof userId === "string" && userId.length > 0 ? userId : "system";
}

function getEnvironment(): string {
  return getTelemetryContext().environment;
}
function getServiceName(): string {
  return getTelemetryContext().serviceName;
}

function truncate(value: string, maxLength = TELEMETRY_STRING_MAX_LENGTH) {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function stringifyUnknown(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function eventNameFor(message: string, fallback = "application_log"): string {
  const normalized = message
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^\w]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
  return normalized.length > 0 ? normalized.slice(0, 100) : fallback;
}

function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      error_name: error.name,
      error_message: truncate(error.message),
      ...(error.stack && { error_stack: truncate(error.stack, 4_000) }),
      ...("cause" in error &&
        (error as { cause?: unknown }).cause !== undefined && {
          error_cause:
            (error as { cause?: unknown }).cause instanceof Error
              ? truncate((error as { cause: Error }).cause.message)
              : truncate(String((error as { cause?: unknown }).cause)),
        }),
    };
  }

  if (error === undefined) return {};

  return {
    error_name: "UnknownError",
    error_message: truncate(stringifyUnknown(error)),
  };
}

function commonLogFields({
  level,
  event,
  message,
  userId,
}: {
  level: "info" | "warn" | "error";
  event: string;
  message: string;
  userId?: string;
}) {
  return {
    level,
    event,
    message,
    service: getServiceName(),
    environment: getEnvironment(),
    ...(userId && { posthogDistinctId: userId, user_id: userId }),
    timestamp: new Date().toISOString(),
  };
}

function emitStructuredLog(
  level: "info" | "warn" | "error",
  message: string,
  fields: LogFields,
): boolean {
  const event =
    typeof fields.event === "string" && fields.event.length > 0
      ? fields.event
      : eventNameFor(message);
  const { userId, error, ...rest } = fields;

  try {
    return emitPostHogLog({
      level,
      event,
      body: message,
      attributes: {
        ...commonLogFields({ level, event, message, userId }),
        ...rest,
        ...serializeError(error),
      },
    });
  } catch {
    return false;
  }
}

export const phLogger = {
  error(message: string, fields: LogFields = {}) {
    const wroteLog = emitStructuredLog("error", message, fields);
    const client = getClient();
    if (!client) {
      if (!wroteLog) console.error(message, fields);
      return;
    }
    try {
      const { userId, error, ...rest } = fields;
      const exception = error instanceof Error ? error : new Error(message);
      const event =
        typeof fields.event === "string" && fields.event.length > 0
          ? fields.event
          : eventNameFor(message);
      client.captureException(exception, distinctIdFor(userId), {
        ...commonLogFields({ level: "error", event, message, userId }),
        ...serializeError(exception),
        message,
        ...rest,
      });
    } catch (telemetryError) {
      console.error(message, { ...fields, telemetryError });
    }
  },

  warn(message: string, fields: LogFields = {}) {
    const wroteLog = emitStructuredLog("warn", message, fields);
    const client = getClient();
    if (!client) {
      if (!wroteLog) console.warn(message, fields);
      return;
    }
    try {
      const { userId, error, ...rest } = fields;
      const event =
        typeof fields.event === "string" && fields.event.length > 0
          ? fields.event
          : eventNameFor(message);
      client.capture({
        distinctId: distinctIdFor(userId),
        event: "log_warn",
        properties: {
          ...commonLogFields({ level: "warn", event, message, userId }),
          ...rest,
          ...serializeError(error),
        },
      });
    } catch (telemetryError) {
      console.warn(message, { ...fields, telemetryError });
    }
  },

  info(message: string, fields: LogFields = {}) {
    const wroteLog = emitStructuredLog("info", message, fields);
    const client = getClient();
    if (!client) {
      if (!wroteLog) console.log(message, fields);
      return;
    }
    try {
      const { userId, error, ...rest } = fields;
      const event =
        typeof fields.event === "string" && fields.event.length > 0
          ? fields.event
          : eventNameFor(message);
      client.capture({
        distinctId: distinctIdFor(userId),
        event: "log_info",
        properties: {
          ...commonLogFields({ level: "info", event, message, userId }),
          ...rest,
          ...serializeError(error),
        },
      });
    } catch (telemetryError) {
      console.log(message, { ...fields, telemetryError });
    }
  },

  event(name: string, fields: EventFields = {}) {
    const client = getClient();
    if (!client) return;
    try {
      const { userId, $set, ...rest } = fields;
      client.capture({
        distinctId: distinctIdFor(userId),
        event: name,
        properties: { ...rest, ...($set && { $set }) },
      });
    } catch {
      // best-effort
    }
  },

  async flush(): Promise<void> {
    await Promise.allSettled([flushClients(), flushPostHogLogs()]);
  },
};
