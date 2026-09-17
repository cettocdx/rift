/**
 * Ops alerting for agent runs.
 *
 * Until this existed, RIFT had no alerting at all. When a Trigger.dev
 * `agent-long` run failed, the only trace was a tag on the Trigger dashboard,
 * and the first anyone heard of it was a user complaining that their agent
 * "just stopped". This module turns a classified failure into a small,
 * redacted Slack message so an operator hears about it within seconds rather
 * than days.
 *
 * Two design rules shape everything here:
 *
 * 1. Alerting must never make the failure worse. `postOpsAlert` never throws,
 *    never blocks longer than five seconds, and degrades to a single warning
 *    log when no webhook is configured. A run that already failed must not
 *    fail a second time because Slack was slow.
 *
 * 2. Alerts are for operators, not for debugging. They carry categories,
 *    codes and ids -- never prompt text, tool output or full error bodies.
 *    Those live in Trigger's run view, which is what `link` points at. Slack
 *    channels get forwarded, screenshotted and searched; a user's prompt does
 *    not belong there.
 *
 * `shouldAlertOnFailure` encodes the quiet list: failures that are the user's
 * own doing (empty prompt, not logged in), that are already surfaced to the
 * user (rate limit, content filter), or that are expected noise at the
 * individual level (a single provider stream drop) do not page anyone. The
 * noisy-but-meaningful ones are instead counted by the daily digest, where a
 * *rate* of stream drops means something a single drop does not.
 */

export interface OpsAlert {
  title: string;
  severity: "info" | "warning" | "critical";
  fields: Array<{ label: string; value: string }>;
  link?: string;
}

export interface RunFailureAlertInput {
  runId: string;
  chatId: string;
  category: string;
  code?: string;
  phase?: string;
  model?: string;
  subscription?: string;
  elapsedMs?: number;
  triggerProjectId?: string;
  triggerOrgSlug?: string;
}

export interface ShouldAlertInput {
  category: string;
  phase?: "setup" | "streaming";
  recoveredViaFallback?: boolean;
  userCancelled?: boolean;
}

export interface PostOpsAlertOptions {
  webhookUrl?: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export interface PostOpsAlertResult {
  sent: boolean;
  reason?: string;
}

/** Longest any single field value may be. Categories and codes are short;
 *  anything longer is almost certainly an error body that leaked in. */
export const MAX_FIELD_VALUE_CHARS = 160;

/** How long we are willing to hold a worker open for Slack. */
export const OPS_ALERT_TIMEOUT_MS = 5_000;

/**
 * Categories that never page on their own. Each is either the user's own
 * action, already surfaced to the user in-product, or an expected concurrency
 * outcome. See the file header for the reasoning.
 */
export const QUIET_FAILURE_CATEGORIES: ReadonlySet<string> = new Set([
  "chat_not_found",
  "login_required",
  "empty_prompt",
  "rate_limited",
  "provider_content_filter",
  "run_conflict",
]);

/**
 * Streaming-phase categories that are noise individually but meaningful as a
 * rate. They are excluded here and counted by `shouldAlertFailureRate` in the
 * digest instead.
 */
export const RATE_ONLY_STREAMING_CATEGORIES: ReadonlySet<string> = new Set([
  "provider_stream_terminated",
  "provider_timeout",
]);

export function shouldAlertOnFailure(input: ShouldAlertInput): boolean {
  if (input.userCancelled) return false;
  if (input.recoveredViaFallback) return false;
  if (QUIET_FAILURE_CATEGORIES.has(input.category)) return false;
  if (
    input.phase === "streaming" &&
    RATE_ONLY_STREAMING_CATEGORIES.has(input.category)
  ) {
    return false;
  }
  return true;
}

const clip = (value: string, max = MAX_FIELD_VALUE_CHARS): string => {
  const flat = value.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max - 1)}…`;
};

const formatElapsed = (ms: number): string => {
  if (!Number.isFinite(ms) || ms < 0) return "unknown";
  if (ms < 1_000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1_000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${minutes}m ${rest}s`;
};

export function buildTriggerRunUrl(input: {
  runId: string;
  triggerProjectId?: string;
  triggerOrgSlug?: string;
}): string | undefined {
  const org = input.triggerOrgSlug?.trim();
  const project = input.triggerProjectId?.trim();
  if (!org || !project || !input.runId) return undefined;
  return `https://cloud.trigger.dev/orgs/${encodeURIComponent(org)}/projects/${encodeURIComponent(project)}/runs/${encodeURIComponent(input.runId)}`;
}

/**
 * Builds the alert for a single failed run. Returns null only when the input
 * is unusable (no run id) -- the decision of whether to *send* belongs to
 * `shouldAlertOnFailure`, so callers can log the decision separately.
 */
export function buildRunFailureAlert(
  input: RunFailureAlertInput,
): OpsAlert | null {
  if (!input.runId) return null;

  const phase = input.phase?.trim() || "unknown";
  const severity: OpsAlert["severity"] =
    phase === "setup" ? "critical" : "warning";
  const category = clip(input.category || "unknown");

  const fields: OpsAlert["fields"] = [
    { label: "Category", value: category },
    { label: "Phase", value: clip(phase) },
    { label: "Run", value: clip(input.runId) },
    { label: "Chat", value: clip(input.chatId || "unknown") },
  ];
  if (input.code) fields.push({ label: "Code", value: clip(input.code) });
  if (input.model) fields.push({ label: "Model", value: clip(input.model) });
  if (input.subscription) {
    fields.push({ label: "Tier", value: clip(input.subscription) });
  }
  if (typeof input.elapsedMs === "number") {
    fields.push({ label: "Elapsed", value: formatElapsed(input.elapsedMs) });
  }

  return {
    title: `Agent run failed (${category}) during ${phase}`,
    severity,
    fields,
    link: buildTriggerRunUrl(input),
  };
}

const SEVERITY_PREFIX: Record<OpsAlert["severity"], string> = {
  info: ":information_source:",
  warning: ":warning:",
  critical: ":rotating_light:",
};

const escapeMrkdwn = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Slack incoming-webhook payload. `text` is the notification fallback and is
 * kept to one line so the phone banner is readable; `blocks` carry the same
 * facts in a scannable grid.
 */
export function formatSlackPayload(alert: OpsAlert): {
  text: string;
  blocks: unknown[];
} {
  const prefix = SEVERITY_PREFIX[alert.severity];
  const summary = alert.fields
    .map((f) => `${f.label}: ${f.value}`)
    .join(" | ");
  const text = `${prefix} ${alert.title}${summary ? ` — ${summary}` : ""}`;

  const blocks: unknown[] = [
    {
      type: "header",
      text: { type: "plain_text", text: clip(alert.title, 150), emoji: true },
    },
  ];

  if (alert.fields.length > 0) {
    // Slack caps a section at 10 fields; chunk so nothing is dropped.
    for (let i = 0; i < alert.fields.length; i += 10) {
      blocks.push({
        type: "section",
        fields: alert.fields.slice(i, i + 10).map((f) => ({
          type: "mrkdwn",
          text: `*${escapeMrkdwn(f.label)}*\n${escapeMrkdwn(f.value)}`,
        })),
      });
    }
  }

  blocks.push({
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text: alert.link
          ? `${prefix} ${alert.severity} · <${alert.link}|Open in Trigger>`
          : `${prefix} ${alert.severity}`,
      },
    ],
  });

  return { text, blocks };
}

let warnedMissingWebhook = false;

/** Test hook: the once-per-process warning flag would otherwise leak between tests. */
export function __resetOpsAlertWarningForTests(): void {
  warnedMissingWebhook = false;
}

/**
 * Posts an alert to the ops webhook. Never throws: the caller is already in
 * a failure path and must not be knocked over by a second one.
 */
export async function postOpsAlert(
  alert: OpsAlert,
  options: PostOpsAlertOptions = {},
): Promise<PostOpsAlertResult> {
  const webhookUrl =
    options.webhookUrl ?? process.env.OPS_ALERT_WEBHOOK_URL ?? "";

  if (!webhookUrl.trim()) {
    if (!warnedMissingWebhook) {
      warnedMissingWebhook = true;
      console.warn(
        "[ops-alerts] OPS_ALERT_WEBHOOK_URL is not set; run-failure alerts are disabled.",
      );
    }
    return { sent: false, reason: "no_webhook" };
  }

  const fetchImpl =
    options.fetchImpl ??
    (typeof fetch === "function" ? fetch : undefined);
  if (!fetchImpl) return { sent: false, reason: "no_fetch" };

  const controller =
    typeof AbortController === "function" ? new AbortController() : undefined;
  const timer = controller
    ? setTimeout(() => controller.abort(), OPS_ALERT_TIMEOUT_MS)
    : undefined;

  try {
    const response = await fetchImpl(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(formatSlackPayload(alert)),
      signal: controller?.signal,
    });
    if (!response.ok) {
      return { sent: false, reason: `http_${response.status}` };
    }
    return { sent: true };
  } catch (error) {
    const aborted =
      typeof error === "object" &&
      error !== null &&
      (error as { name?: unknown }).name === "AbortError";
    return { sent: false, reason: aborted ? "timeout" : "network" };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
