/**
 * Scheduled OpenRouter credit check.
 *
 * Production ran dry on 2026-09-02 with $0.66 in the OpenRouter account and
 * every agent run failing on a 402 until someone noticed by hand. There was
 * no monitor because the balance lives behind an API key that only the
 * worker has, and the worker had no schedule that ran when nothing was
 * happening. This task is that schedule.
 *
 * Throttling is stateless on purpose. Trigger.dev keeps no state between
 * runs of a scheduled task, and adding a store just to remember "I already
 * said this" would give the monitor a dependency that can itself fail. So:
 * below the critical line it posts every 30 minutes (that is the desired
 * behaviour -- the account is about to stop serving), and in the warn band
 * it posts only on the check that lands at the top of every sixth UTC hour
 * (00:00, 06:00, 12:00, 18:00). See `shouldPostCreditsAlertAt`.
 *
 * Requires OPENROUTER_API_KEY and OPS_ALERT_WEBHOOK_URL in the Trigger.dev
 * environment. Without the webhook it still logs the balance each run, which
 * is enough to reconstruct a timeline after the fact.
 */
import { schedules } from "@trigger.dev/sdk";
import { postOpsAlert } from "../lib/ops/alerts";
import {
  buildCreditsAlert,
  classifyCreditsBand,
  fetchOpenRouterCredits,
  shouldPostCreditsAlertAt,
} from "../lib/ops/credits";

export const CREDITS_CHECK_INTERVAL_MINUTES = 30;

export const opsCreditsCheckTask = schedules.task({
  id: "ops-credits-check",
  cron: "*/30 * * * *",
  maxDuration: 60,
  machine: { preset: "micro" },
  run: async (payload) => {
    const now = payload.timestamp ?? new Date();
    const apiKey = process.env.OPENROUTER_API_KEY ?? "";

    if (!apiKey.trim()) {
      console.log(
        JSON.stringify({
          event: "ops-credits-check",
          ok: false,
          reason: "no_api_key",
        }),
      );
      return { ok: false, reason: "no_api_key" as const };
    }

    const credits = await fetchOpenRouterCredits({ apiKey });

    if (!credits) {
      // A check that cannot read the balance is worth a word, but not every
      // half hour: OpenRouter blips happen. Use the warn-band cadence.
      const post = shouldPostCreditsAlertAt({
        band: "warn",
        now,
        checkIntervalMinutes: CREDITS_CHECK_INTERVAL_MINUTES,
      });
      let alerted = false;
      if (post) {
        const result = await postOpsAlert({
          title: "OpenRouter credits check failed",
          severity: "warning",
          fields: [
            { label: "Reason", value: "credits endpoint unreachable or malformed" },
            { label: "Checked at", value: now.toISOString() },
          ],
          link: "https://openrouter.ai/settings/credits",
        });
        alerted = result.sent;
      }
      console.log(
        JSON.stringify({
          event: "ops-credits-check",
          ok: false,
          reason: "fetch_failed",
          alerted,
        }),
      );
      return { ok: false, reason: "fetch_failed" as const, alerted };
    }

    const band = classifyCreditsBand(credits.remaining);
    const post = shouldPostCreditsAlertAt({
      band,
      now,
      checkIntervalMinutes: CREDITS_CHECK_INTERVAL_MINUTES,
    });

    let alerted = false;
    let alertReason: string | undefined;
    if (post) {
      const result = await postOpsAlert(buildCreditsAlert({ ...credits, band }));
      alerted = result.sent;
      alertReason = result.reason;
    }

    console.log(
      JSON.stringify({
        event: "ops-credits-check",
        ok: true,
        remaining: credits.remaining,
        totalCredits: credits.totalCredits,
        totalUsage: credits.totalUsage,
        band,
        alerted,
        ...(alertReason ? { alertReason } : {}),
      }),
    );

    return { ok: true as const, remaining: credits.remaining, band, alerted };
  },
});
