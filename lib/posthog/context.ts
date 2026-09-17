/** Allowlisted immutable telemetry destination. Safe for shared/edge imports. */
export type TelemetryContext = Readonly<{
  analyticsKey: string | undefined;
  analyticsHost: string;
  logToken: string | undefined;
  logHost: string;
  serviceName: string;
  environment: string;
  version: string;
}>;
let readContext: (() => TelemetryContext | undefined) | undefined;
let defaultContext: TelemetryContext | undefined;

export function installTelemetryContextReader(
  reader: () => TelemetryContext | undefined,
) {
  readContext = reader;
}
export function getScopedTelemetryContext(): TelemetryContext | undefined {
  return readContext?.();
}

function normalizeLogHost(raw: string): string {
  const host = raw.replace(/\/+$/, "");
  if (host === "https://app.posthog.com" || host === "https://us.posthog.com")
    return "https://us.i.posthog.com";
  if (host === "https://eu.posthog.com") return "https://eu.i.posthog.com";
  return host;
}

export function captureTelemetryContext(): TelemetryContext {
  return Object.freeze({
    analyticsKey: process.env.NEXT_PUBLIC_POSTHOG_KEY,
    analyticsHost:
      process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com",
    logToken:
      process.env.POSTHOG_PROJECT_TOKEN ?? process.env.NEXT_PUBLIC_POSTHOG_KEY,
    logHost: normalizeLogHost(
      process.env.POSTHOG_LOG_HOST ??
        process.env.NEXT_PUBLIC_POSTHOG_HOST ??
        "https://us.i.posthog.com",
    ),
    serviceName: process.env.POSTHOG_LOG_SERVICE_NAME ?? "rift-web",
    environment:
      process.env.VERCEL_ENV ??
      process.env.NODE_ENV ??
      process.env.ENVIRONMENT ??
      "unknown",
    version: process.env.VERCEL_GIT_COMMIT_SHA ?? "dev",
  });
}

/** Scoped missing settings stay missing; unscoped web calls follow config changes. */
export function getTelemetryContext(): TelemetryContext {
  const scoped = getScopedTelemetryContext();
  if (scoped) return scoped;
  const next = captureTelemetryContext();
  if (
    !defaultContext ||
    (Object.keys(next) as Array<keyof TelemetryContext>).some(
      (key) => next[key] !== defaultContext![key],
    )
  )
    defaultContext = next;
  return defaultContext;
}
