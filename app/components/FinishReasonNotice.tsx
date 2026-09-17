import { useState } from "react";
import Link from "next/link";
import type { ChatMode, ChatPurpose } from "@/types/chat";
import { useDataStreamState } from "@/app/components/DataStreamProvider";
import { MAX_AUTO_CONTINUES } from "@/app/hooks/useAutoContinue";
import { useSettingsNavigation } from "@/app/components/settings/useSettingsNavigation";
import {
  BUDGET_EXHAUSTION_FINISH_REASON,
  DOOM_LOOP_FINISH_REASON,
  PREEMPTIVE_TIMEOUT_FINISH_REASON,
  TOKEN_EXHAUSTION_FINISH_REASON,
} from "@/lib/chat/stop-conditions";
import { Button } from "@/components/ui/button";

/**
 * Finish reasons from `stop-conditions` that this notice deliberately renders
 * nothing for. Every other `*_FINISH_REASON` constant must produce a notice;
 * a test enforces this so a new stop condition cannot silently show up to the
 * user as a blank space where an explanation should be.
 */
export const SUPPRESSED_FINISH_REASONS: readonly string[] = [];

interface FinishReasonNoticeProps {
  finishReason?: string;
  mode?: ChatMode;
  purpose?: ChatPurpose;
  onContinue?: () => void;
}

export const FinishReasonNotice = ({
  finishReason,
  mode,
  purpose,
  onContinue,
}: FinishReasonNoticeProps) => {
  const { isAutoResuming, autoContinueCount } = useDataStreamState();
  const { hrefFor } = useSettingsNavigation();
  const [hasContinued, setHasContinued] = useState(false);

  if (isAutoResuming) return null;
  if (hasContinued) return null;

  // Build runs hand wall-clock exhaustion to the durable auto-continuation
  // pipeline. A timeout is an internal segment boundary there, not a user
  // facing failure. Never flash the old "Reached the time limit" notice while
  // the next durable Build leg is being prepared.
  if (
    mode === "agent" &&
    purpose === "app" &&
    (finishReason === "timeout" ||
      finishReason === PREEMPTIVE_TIMEOUT_FINISH_REASON)
  ) {
    return null;
  }

  // Suppress for auto-continuable reasons in agent mode when more auto-continues will fire
  if (
    mode === "agent" &&
    autoContinueCount < MAX_AUTO_CONTINUES &&
    (finishReason === TOKEN_EXHAUSTION_FINISH_REASON ||
      finishReason === "length" ||
      finishReason === PREEMPTIVE_TIMEOUT_FINISH_REASON ||
      finishReason === "tool-calls")
  ) {
    return null;
  }

  if (!finishReason) return null;

  const getNoticeContent = () => {
    if (finishReason === "tool-calls") {
      return <>Reached the step limit for this turn.</>;
    }

    if (
      finishReason === "timeout" ||
      finishReason === PREEMPTIVE_TIMEOUT_FINISH_REASON
    ) {
      return <>Reached the time limit for this turn.</>;
    }

    if (finishReason === "length") {
      return <>Reached the output limit for this turn.</>;
    }

    if (finishReason === TOKEN_EXHAUSTION_FINISH_REASON) {
      return <>Reached the context limit for this conversation.</>;
    }

    if (finishReason === DOOM_LOOP_FINISH_REASON) {
      return (
        <>
          The agent stopped because it kept repeating the same action without
          making progress.
        </>
      );
    }

    if (finishReason === BUDGET_EXHAUSTION_FINISH_REASON) {
      return <>Stopped: your usage budget is exhausted.</>;
    }

    return null;
  };

  const content = getNoticeContent();

  if (!content) return null;

  // A budget cutoff cannot be continued: the next leg would stop the same
  // way. The only useful action is the billing page.
  const isBudgetExhausted = finishReason === BUDGET_EXHAUSTION_FINISH_REASON;

  return (
    <div className="mt-2 w-full">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-muted px-2.5 py-1.5 text-[12px] text-muted-foreground">
        <span className="leading-4">{content}</span>
        {isBudgetExhausted ? (
          <Button type="button" size="xs" variant="outline" asChild>
            <Link href={hrefFor("billing")}>Add credits</Link>
          </Button>
        ) : (
          onContinue &&
          !hasContinued && (
            <Button
              type="button"
              size="xs"
              variant="outline"
              onClick={() => {
                setHasContinued(true);
                onContinue();
              }}
            >
              Continue
            </Button>
          )
        )}
      </div>
    </div>
  );
};
