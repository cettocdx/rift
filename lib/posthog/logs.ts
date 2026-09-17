import { recordTelemetryLoss } from "./delivery-stats";
import {
  getTelemetryContext,
  getScopedTelemetryContext,
  type TelemetryContext,
} from "./context";
type LogLevel = "info" | "warn" | "error";
type OtlpValue =
  | { stringValue: string }
  | { doubleValue: number }
  | { boolValue: boolean };

type OtlpAttribute = {
  key: string;
  value: OtlpValue;
};

type QueuedLogRecord = {
  timeUnixNano: string;
  severityNumber: number;
  severityText: string;
  body: { stringValue: string };
  attributes: OtlpAttribute[];
};

type EmitLogOptions = {
  level: LogLevel;
  event: string;
  body: string;
  attributes?: Record<string, unknown>;
};

const LOG_ATTRIBUTE_VALUE_MAX_LENGTH = 2_000;
const LOG_ATTRIBUTE_COUNT_LIMIT = 80;
const LOG_BATCH_SIZE = 50;
const LOG_QUEUE_LIMIT = 1_000;
const LOG_FLUSH_INTERVAL_MS = 2_000;
const LOG_EXPORT_TIMEOUT_MS = 5_000;
const LOG_ORIGIN_LIMIT = 32;
const POSTHOG_CORRELATION_KEYS = new Set(["posthogDistinctId", "sessionId"]);

type PendingLog = { sequence: number; record: QueuedLogRecord };
type LogQueue = {
  context: TelemetryContext;
  pending: PendingLog[];
  flushing: Promise<void> | null;
  timer: ReturnType<typeof setTimeout> | null;
};
const queues = new Map<TelemetryContext, LogQueue>();
let pendingCount = 0;
let sequence = 0;

function truncate(value: string, maxLength = LOG_ATTRIBUTE_VALUE_MAX_LENGTH) {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function releaseEmptyQueue(queue: LogQueue) {
  if (queue.pending.length || queue.flushing) return;
  if (queue.timer) clearTimeout(queue.timer);
  queue.timer = null;
  queues.delete(queue.context);
}

/** Retire only idle state; failed destinations cannot monopolize every slot. */
function retireOldestIdleQueue(): boolean {
  for (const queue of queues.values()) {
    if (queue.flushing) continue;
    pendingCount -= queue.pending.length;
    recordTelemetryLoss("droppedLogRecords", queue.pending.length);
    queue.pending = [];
    releaseEmptyQueue(queue);
    return true;
  }
  return false;
}

function trimOldestLog() {
  let oldest: LogQueue | undefined;
  for (const queue of queues.values()) {
    if (
      queue.pending.length &&
      (!oldest || queue.pending[0].sequence < oldest.pending[0].sequence)
    )
      oldest = queue;
  }
  if (!oldest) return;
  oldest.pending.shift();
  pendingCount--;
  recordTelemetryLoss("droppedLogRecords");
  releaseEmptyQueue(oldest);
}

function severityNumberFor(level: LogLevel): number {
  if (level === "error") return 17;
  if (level === "warn") return 13;
  return 9;
}

function normalizeAttributeKey(key: string): string {
  if (POSTHOG_CORRELATION_KEYS.has(key)) {
    return key;
  }

  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^\w.]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

function stringifyUnknown(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function toOtlpValue(value: unknown): OtlpValue | undefined {
  if (value === undefined || value === null) return undefined;

  if (typeof value === "string") {
    return { stringValue: truncate(value) };
  }
  if (typeof value === "boolean") {
    return { boolValue: value };
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return undefined;
    return { doubleValue: value };
  }

  return { stringValue: truncate(stringifyUnknown(value)) };
}

function toOtlpAttributes(
  context: TelemetryContext,
  attributes: Record<string, unknown> = {},
): OtlpAttribute[] {
  const normalized: Record<string, unknown> = {
    service: context.serviceName,
    environment: context.environment,
    runtime: "node",
    ...attributes,
  };

  return Object.entries(normalized)
    .flatMap(([key, value]) => {
      const normalizedKey = normalizeAttributeKey(key);
      if (!normalizedKey) return [];

      const otlpValue = toOtlpValue(value);
      if (!otlpValue) return [];

      return [{ key: normalizedKey, value: otlpValue }];
    })
    .slice(0, LOG_ATTRIBUTE_COUNT_LIMIT);
}

function nowUnixNano(): string {
  return `${BigInt(Date.now()) * BigInt(1_000_000)}`;
}

function buildOtlpPayload(logs: QueuedLogRecord[], context: TelemetryContext) {
  return {
    resourceLogs: [
      {
        resource: {
          attributes: [
            {
              key: "service.name",
              value: { stringValue: context.serviceName },
            },
            {
              key: "deployment.environment",
              value: { stringValue: context.environment },
            },
            {
              key: "service.version",
              value: {
                stringValue: context.version,
              },
            },
          ],
        },
        scopeLogs: [
          {
            scope: { name: context.serviceName },
            logRecords: logs,
          },
        ],
      },
    ],
  };
}

function scheduleFlush(queue: LogQueue, delayMs: number): void {
  if (queue.timer) {
    if (delayMs > 0) return;
    clearTimeout(queue.timer);
  }
  queue.timer = setTimeout(() => {
    queue.timer = null;
    void flushQueue(queue).catch(() => {
      /* best-effort telemetry */
    });
  }, delayMs);
  queue.timer.unref?.();
}

export function registerPostHogLogProvider() {
  // Kept as an explicit hook for Next instrumentation; the raw OTLP sender is
  // initialized lazily so builds and edge runtimes do not need log setup work.
}

export function emitPostHogLog({
  level,
  event,
  body,
  attributes,
}: EmitLogOptions): boolean {
  const context = getTelemetryContext();
  if (!context.logToken) return false;
  let queue = queues.get(context);
  if (!queue) {
    // Bound the number of independent exporters as well as aggregate records.
    if (queues.size >= LOG_ORIGIN_LIMIT && !retireOldestIdleQueue()) {
      recordTelemetryLoss("rejectedLogRecords");
      return false;
    }
    queue = { context, pending: [], flushing: null, timer: null };
    queues.set(context, queue);
  }
  while (pendingCount >= LOG_QUEUE_LIMIT) trimOldestLog();
  // Trimming may have released this queue if it held the oldest record.
  queues.set(context, queue);
  queue.pending.push({
    sequence: sequence++,
    record: {
      timeUnixNano: nowUnixNano(),
      severityNumber: severityNumberFor(level),
      severityText: level.toUpperCase(),
      body: { stringValue: truncate(body) },
      attributes: toOtlpAttributes(context, {
        event,
        ...attributes,
      }),
    },
  });

  pendingCount++;
  scheduleFlush(
    queue,
    queue.pending.length >= LOG_BATCH_SIZE ? 0 : LOG_FLUSH_INTERVAL_MS,
  );

  return true;
}

async function flushBatch(
  logs: QueuedLogRecord[],
  context: TelemetryContext,
): Promise<void> {
  const token = context.logToken;
  if (!token || logs.length === 0) return;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LOG_EXPORT_TIMEOUT_MS);
  timeout.unref?.();

  try {
    const response = await fetch(`${context.logHost}/i/v1/logs`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify(buildOtlpPayload(logs, context)),
    });

    if (!response.ok) {
      throw new Error(`PostHog log export failed: ${response.status}`);
    }
  } finally {
    clearTimeout(timeout);
  }
}

function flushQueue(queue: LogQueue): Promise<void> {
  if (queue.timer) clearTimeout(queue.timer);
  queue.timer = null;
  if (queue.flushing) return queue.flushing;
  if (!queue.pending.length) {
    releaseEmptyQueue(queue);
    return Promise.resolve();
  }
  // Publish the shared promise before the first await so concurrent flushes
  // cannot send the same batch twice. Every retry retains this queue's origin.
  queue.flushing = Promise.resolve()
    .then(async () => {
      while (queue.pending.length) {
        const batch = queue.pending.slice(0, LOG_BATCH_SIZE);
        await flushBatch(
          batch.map((item) => item.record),
          queue.context,
        );
        const sent = new Set(batch);
        const before = queue.pending.length;
        queue.pending = queue.pending.filter((item) => !sent.has(item));
        pendingCount -= before - queue.pending.length;
      }
    })
    .finally(() => {
      queue.flushing = null;
      if (queue.pending.length) scheduleFlush(queue, LOG_FLUSH_INTERVAL_MS);
      else releaseEmptyQueue(queue);
    });
  return queue.flushing;
}

export async function flushPostHogLogs(): Promise<void> {
  const context = getScopedTelemetryContext();
  if (context) {
    const queue = queues.get(context);
    if (queue) await flushQueue(queue);
    return;
  }
  // Unscoped process shutdown still drains all destinations, each with its
  // captured credentials. A worker's scoped flush never waits for another run.
  await Promise.all([...queues.values()].map(flushQueue));
}
