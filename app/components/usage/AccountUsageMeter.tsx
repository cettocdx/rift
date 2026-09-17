"use client";

import Link from "next/link";
import { TriangleAlert } from "lucide-react";

/**
 * The allowance, at the top of the account menu.
 *
 * The menu opens from the one row that is always on screen, so it is where
 * someone looks when they wonder how much is left — and it used to answer with
 * a prepaid token count and nothing else, which says how much you bought, not
 * how much of the month you have spent. This reports the included allowance as
 * a proportion, because that is the question.
 *
 * It reports only what the ledger actually returns. A plan with no monthly
 * allowance has no proportion to draw, so the meter does not appear at all
 * rather than drawing an empty bar or a 0% that reads as "you have used
 * nothing" when the truth is "this plan does not work that way".
 */

/** Thirty-two segments keep the allowance readable at compact sizes. */
const SEGMENT_COUNT = 32;

/**
 * Where the meter starts warning.
 *
 * Not a colour preference: below this there is nothing to act on, and a bar
 * that is amber for most of its range trains people to ignore it.
 */
const WARN_AT = 0.8;

export function AccountUsageMeter({
  used,
  total,
  upgradeHref,
  upgradeLabel,
  resetAt,
  variant = "card",
}: {
  /** Allowance consumed this period, in the ledger's own points. */
  used: number;
  /** Allowance granted this period. Zero means the plan has no allowance. */
  total: number;
  /** Omitted when there is nothing to upgrade to, which hides the prompt. */
  upgradeHref?: string;
  /** The plan being offered, e.g. "Max". */
  upgradeLabel?: string;
  resetAt?: string | null;
  /** Use the bare bar when the surrounding panel already labels the balance. */
  variant?: "card" | "bar";
}) {
  // Nothing to report is reported as nothing. Guarding on a finite, positive
  // total also keeps a bad row out of the division below.
  if (!Number.isFinite(total) || total <= 0) return null;
  if (!Number.isFinite(used) || used < 0) return null;

  const fraction = Math.min(1, used / total);
  // Round toward the reader's disadvantage: 99.4% used is not "99%" of a
  // budget you are about to run out of, and 0.2% is not yet "0".
  const percent = Math.min(100, Math.ceil(fraction * 100));
  const filled = Math.min(
    SEGMENT_COUNT,
    // Any consumption at all lights the first segment, so a nearly-empty bar
    // still reads as started rather than untouched.
    used > 0 ? Math.max(1, Math.round(fraction * SEGMENT_COUNT)) : 0,
  );
  const warning = fraction >= WARN_AT;

  const segments = (
    <div
      className="rift-usage-segments"
      role="img"
      aria-label={`${percent}% of this period's allowance used`}
    >
      {Array.from({ length: SEGMENT_COUNT }, (_, index) => (
        <span
          key={index}
          aria-hidden
          data-filled={index < filled}
          data-warning={warning}
        />
      ))}
    </div>
  );

  if (variant === "bar") return segments;

  const resetDate = resetAt ? new Date(resetAt) : null;
  const resetLabel =
    resetDate && Number.isFinite(resetDate.getTime())
      ? new Intl.DateTimeFormat("en-US", {
          month: "short",
          day: "numeric",
          timeZone: "UTC",
        }).format(resetDate)
      : null;

  return (
    <div className="rift-usage-meter">
      <div className="flex items-center justify-between gap-3">
        <span className="text-ui font-medium">Your usage limit</span>
        <span className="flex items-center gap-1.5 text-ui tabular-nums text-muted-foreground">
          {warning ? (
            <TriangleAlert
              aria-hidden
              className="size-3.5 text-[var(--warning)]"
            />
          ) : null}
          {percent}%
        </span>
      </div>
      {segments}
      {resetLabel ? (
        <p className="text-ui-label text-muted-foreground">
          Resets {resetLabel} (UTC)
        </p>
      ) : null}
      {upgradeHref ? (
        <p className="mt-2 text-ui-label text-muted-foreground">
          {upgradeLabel
            ? `Upgrade to ${upgradeLabel} for extended usage.`
            : "Upgrade for extended usage."}{" "}
          <Link
            href={upgradeHref}
            className="underline underline-offset-2 hover:text-foreground"
          >
            Learn more
          </Link>
        </p>
      ) : null}
    </div>
  );
}
