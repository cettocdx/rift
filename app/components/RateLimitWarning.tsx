import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { useSettingsNavigation } from "@/app/components/settings/useSettingsNavigation";
import type { ChatMode, SubscriptionTier } from "@/types";

// Discriminated union for warning data
export type RateLimitWarningData =
  | {
      warningType: "sliding-window";
      remaining: number;
      resetTime: Date;
      mode: ChatMode;
      subscription: SubscriptionTier;
    }
  | {
      warningType: "token-bucket";
      bucketType: "monthly";
      remainingPercent: number;
      resetTime: Date;
      subscription: SubscriptionTier;
      severity?: "info" | "warning";
      usedDollars?: number;
      limitDollars?: number;
      midStream?: boolean;
      cutOff?: boolean;
    }
  | {
      warningType: "extra-usage-active";
      bucketType: "monthly";
      resetTime: Date;
      subscription: SubscriptionTier;
      midStream?: boolean;
    }
  | {
      // One run's spend against its own ceiling. No reset time: it is not a
      // bucket, and the next run starts from zero.
      warningType: "run-budget";
      usedPercent: number;
      usedDollars: number;
      ceilingDollars: number;
      subscription: SubscriptionTier;
      midStream?: boolean;
      cutOff?: boolean;
    };

interface RateLimitWarningProps {
  data: RateLimitWarningData;
  onDismiss: () => void;
}

const formatTimeUntil = (resetTime: Date): string => {
  const now = new Date();
  const timeDiff = resetTime.getTime() - now.getTime();

  if (timeDiff <= 0) {
    return "now";
  }

  const daysUntil = Math.floor(timeDiff / (1000 * 60 * 60 * 24));
  const hoursUntil = Math.floor(
    (timeDiff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60),
  );
  const minutesUntil = Math.floor((timeDiff % (1000 * 60 * 60)) / (1000 * 60));

  if (daysUntil === 0 && hoursUntil === 0 && minutesUntil === 0) {
    return "in less than a minute";
  }
  if (daysUntil >= 1 && hoursUntil === 0) {
    return `in ${daysUntil} ${daysUntil === 1 ? "day" : "days"}`;
  }
  if (daysUntil >= 1) {
    return `in ${daysUntil}d ${hoursUntil}h`;
  }
  if (hoursUntil === 0) {
    return `in ${minutesUntil} ${minutesUntil === 1 ? "minute" : "minutes"}`;
  }
  if (minutesUntil === 0) {
    return `in ${hoursUntil} ${hoursUntil === 1 ? "hour" : "hours"}`;
  }
  return `in ${hoursUntil}h ${minutesUntil}m`;
};

const getMessage = (data: RateLimitWarningData, timeString: string): string => {
  if (data.warningType === "run-budget") {
    const used = `$${data.usedDollars.toFixed(2)} of this run's $${data.ceilingDollars.toFixed(2)} limit`;
    if (data.cutOff) {
      return `This run reached its $${data.ceilingDollars.toFixed(2)} spending limit and was stopped. Your work so far is saved; start a new message to continue.`;
    }
    return `This run has used ${used} (${data.usedPercent}%).`;
  }

  if (data.warningType === "sliding-window") {
    return data.remaining === 0
      ? `You've used all your daily requests. Daily requests reset at midnight UTC.`
      : `You have ${data.remaining} daily ${data.remaining === 1 ? "request" : "requests"} remaining today.`;
  }

  if (data.warningType === "extra-usage-active") {
    return `You're now using extra usage credits. Your monthly limit resets ${timeString}.`;
  }

  // Token bucket warning — show dollar amounts when available
  if (data.remainingPercent === 0) {
    if (data.cutOff) {
      if (data.subscription === "free") {
        return `You've used your daily free allowance and this response was cut off. Buy tokens to keep going, or wait; it resets ${timeString}.`;
      }
      return `You've reached your monthly limit and this response was cut off. Buy tokens to continue. Resets ${timeString}.`;
    }
    return `You've reached your monthly usage limit. It resets ${timeString}.`;
  }

  const usedPercent = 100 - data.remainingPercent;
  if (data.usedDollars !== undefined && data.limitDollars !== undefined) {
    return `You've used $${data.usedDollars.toFixed(2)} of $${data.limitDollars.toFixed(2)} (${usedPercent}%). Resets ${timeString}.`;
  }

  return `You have ${data.remainingPercent}% of your monthly usage remaining. It resets ${timeString}.`;
};

const WARNING_STYLES = "bg-input-chat border-black/8 dark:border-border";

export const RateLimitWarning = ({
  data,
  onDismiss,
}: RateLimitWarningProps) => {
  const { hrefFor } = useSettingsNavigation();
  const timeString =
    "resetTime" in data ? formatTimeUntil(data.resetTime) : "";
  const message = getMessage(data, timeString);
  // PAYG: non-team users top up by buying tokens (no plan upgrades).
  const showBuyTokens =
    data.warningType !== "extra-usage-active" &&
    data.warningType !== "run-budget" &&
    data.subscription !== "team";

  return (
    <div
      data-testid="rate-limit-warning"
      className={`mb-1.5 flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 ${WARNING_STYLES}`}
    >
      <div className="flex flex-1 flex-wrap items-center gap-2">
        <span className="text-[12px] leading-4 text-foreground/80">
          {message}
        </span>
        {showBuyTokens && (
          <Button
            asChild
            size="xs"
            variant="outline"
            className="border-border px-2 text-[11px] font-medium"
          >
            <Link href={hrefFor("billing")}>Buy tokens</Link>
          </Button>
        )}
      </div>
      <button
        onClick={onDismiss}
        className="flex size-6 flex-shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none"
        aria-label="Dismiss warning"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
};
