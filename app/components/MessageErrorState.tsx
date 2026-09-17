import { needsWorkReconciliation } from "@/lib/chat/recovery-request";
import {
  isProviderCreditsExhaustedMessage,
  isAccountCreditsExhaustedMessage,
  isProviderInFlightCapacityMessage,
} from "@/lib/utils/error-utils";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { MemoizedMarkdown } from "./MemoizedMarkdown";
import { ChatSDKError, isNetworkStreamError } from "@/lib/errors";
import { useGlobalState } from "@/app/contexts/GlobalState";
import { redirectToPricing } from "@/app/hooks/usePricingDialog";
import Link from "next/link";
import { useSettingsNavigation } from "@/app/components/settings/useSettingsNavigation";

interface MessageErrorStateProps {
  error: Error;
  onRetry: () => void;
  onReconnect?: () => void | Promise<void>;
}

const formatCountdown = (ms: number): string => {
  if (ms <= 0) return "";
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${seconds}s`;
};

export const MessageErrorState = ({
  error,
  onRetry,
  onReconnect,
}: MessageErrorStateProps) => {
  const { subscription } = useGlobalState();
  const { hrefFor } = useSettingsNavigation();
  const billingHref = hrefFor("billing");
  const isRateLimitError =
    (error instanceof ChatSDKError && error.type === "rate_limit") ||
    isAccountCreditsExhaustedMessage(
      typeof error.cause === "string" ? error.cause : error.message,
    );
  const canReconcile = needsWorkReconciliation(error);
  const canReconnect = !!onReconnect && isNetworkStreamError(error);

  const metadata = error instanceof ChatSDKError ? error.metadata : undefined;
  const resetTimestamp = metadata?.resetTimestamp as number | undefined;

  const [timeRemaining, setTimeRemaining] = useState<number>(0);
  const [isReconnecting, setIsReconnecting] = useState(false);

  const handleReconnect = async () => {
    if (!onReconnect || isReconnecting) return;
    setIsReconnecting(true);
    try {
      await onReconnect();
    } finally {
      setIsReconnecting(false);
    }
  };

  useEffect(() => {
    if (!resetTimestamp) return;

    const update = () =>
      setTimeRemaining(Math.max(0, resetTimestamp - Date.now()));
    update();
    const interval = setInterval(update, 1_000);
    return () => {
      clearInterval(interval);
      setTimeRemaining(0);
    };
  }, [resetTimestamp]);

  // Extract error message - check for cause first, then message
  const errorMessage = (() => {
    if (error instanceof ChatSDKError) {
      return typeof error.cause === "string" ? error.cause : error.message;
    }
    return error.message || "An error occurred.";
  })();

  // The provider's own account is out of money. Not the user's fault, not
  // transient, and Retry cannot help until the operator tops up -- so say so
  // plainly and do not offer a button that will fail again. Surfacing this as
  // a generic provider error is how it stayed invisible: the user saw a red
  // box and a Retry, pressed it, and got the same box.
  // Structured account limits take precedence over provider text heuristics.
  // Our billing messages also contain "add credits"; that is not evidence
  // of an upstream provider account being empty.
  const isProviderInFlightCapacity =
    !isRateLimitError && isProviderInFlightCapacityMessage(errorMessage);
  const isProviderCreditsExhausted =
    !isRateLimitError && isProviderCreditsExhaustedMessage(errorMessage);

  const isPaidUser = subscription !== "free";
  const canUpgrade =
    subscription === "free" ||
    subscription === "pro" ||
    subscription === "pro-plus";
  const isSuspensionError = metadata?.suspensionCategory !== undefined;

  return (
    <div
      className={
        canReconcile
          ? "bg-muted/30 border border-border rounded-lg p-3"
          : "bg-destructive/10 border border-destructive/20 rounded-lg p-3"
      }
    >
      <div
        className={
          canReconcile
            ? "text-foreground text-sm mb-2"
            : "text-destructive text-sm mb-2"
        }
      >
        <div role="alert">
          {isProviderInFlightCapacity ? (
            <p>
              The model provider is temporarily at capacity. Your work is saved.
              This attempt could not finish. Retry to continue when capacity is
              available.
            </p>
          ) : isProviderCreditsExhausted ? (
            <p data-testid="provider-credits-exhausted">
              The model provider&apos;s account balance is exhausted, so this
              request could not run. Provider funding needs attention. Retrying
              will not help until the balance is topped up.
            </p>
          ) : canReconcile ? (
            <p>
              RIFT can inspect the saved work before continuing, without blindly
              repeating the action.
            </p>
          ) : isRateLimitError ? (
            <MemoizedMarkdown content={errorMessage} />
          ) : (
            <p>{errorMessage}</p>
          )}
        </div>
        {isRateLimitError && timeRemaining > 0 && (
          <p className="text-xs text-muted-foreground mt-1">
            Resets in {formatCountdown(timeRemaining)}
          </p>
        )}
      </div>
      <div className="flex gap-2 flex-wrap">
        {isProviderCreditsExhausted ? null : isRateLimitError ? (
          <>
            <Button
              variant="destructive"
              size="sm"
              onClick={onRetry}
              disabled={timeRemaining > 0 && !isPaidUser}
            >
              {timeRemaining > 0 && !isPaidUser
                ? `Try again in ${formatCountdown(timeRemaining)}`
                : "Try Again"}
            </Button>
            {/* Both of these are the balance page. "Usage" used to resolve
                to the account section, which is not where a balance lives. */}
            <Button variant="outline" size="sm" asChild>
              <Link href={billingHref}>View Usage</Link>
            </Button>
            {isPaidUser && (
              <Button variant="outline" size="sm" asChild>
                <Link href={billingHref}>Add Credits</Link>
              </Button>
            )}
            {canUpgrade && (
              <Button variant="default" size="sm" onClick={redirectToPricing}>
                Upgrade Plan
              </Button>
            )}
          </>
        ) : (
          <>
            {isSuspensionError ? (
              <Button
                variant="default"
                size="sm"
                onClick={() =>
                  window.open(
                    "https://help.rift.co/",
                    "_blank",
                    "noopener,noreferrer",
                  )
                }
              >
                Contact Support
              </Button>
            ) : (
              <>
                {canReconnect && (
                  <Button
                    variant="default"
                    size="sm"
                    onClick={handleReconnect}
                    disabled={isReconnecting}
                  >
                    {isReconnecting ? "Reconnecting..." : "Reconnect"}
                  </Button>
                )}
                <Button
                  variant={canReconcile ? "outline" : "destructive"}
                  size="sm"
                  onClick={onRetry}
                >
                  {canReconcile ? "Inspect and continue" : "Retry"}
                </Button>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
};
