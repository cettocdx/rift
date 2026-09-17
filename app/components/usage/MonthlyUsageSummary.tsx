"use client";

import {
  type ComponentPropsWithoutRef,
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useQuery } from "convex/react";
import { ChevronDown, ChevronRight, Gauge } from "lucide-react";
import Link from "next/link";

import { useIsMobile } from "@/hooks/use-mobile";
import { api } from "@/convex/_generated/api";
import { mockBillingQueryArgs } from "@/lib/billing/mock-billing";
import { AddOnCreditsDialog } from "@/app/components/extra-usage";
import type { SubscriptionTier } from "@/types";
import { POINTS_PER_DOLLAR } from "@/lib/billing/credit-units";
import { formatTokens } from "@/lib/billing/token-display";
import { cn } from "@/lib/utils";
import { AccountUsageMeter } from "./AccountUsageMeter";
import styles from "./MonthlyUsageSummary.module.css";
import { Sparkline } from "@/components/dither-kit/sparkline";
import type { MonthlyUsageSummary as MonthlyUsageData } from "@/lib/monthly-usage";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

type SummaryMode = "compact" | "expanded";

type MonthlyUsageQueryResult = MonthlyUsageData & {
  periodStart: number;
  periodEnd: number;
  /** Zero-filled per-day token series for the month; absent when unknown. */
  dailyTokens?: number[];
};

type MonthlyUsageApiResult = {
  ok: boolean;
  dailyTokens?: number[];
  periodStart?: number;
  periodEnd?: number;
  requestCount?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  totalTokens?: number;
};

type IncludedCreditsStatus = {
  total: number;
  used: number;
  remaining: number;
  resetAt: string | null;
};

type IncludedCreditsLoadState = "loading" | "loaded" | "unavailable";

const NUMBER_FORMATTER = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});
const COMPACT_NUMBER_FORMATTER = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});
const MONTH_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});
const RESET_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});
const formatMetric = (value: number | null): string =>
  value === null ? "Not available" : COMPACT_NUMBER_FORMATTER.format(value);

const formatMetricTitle = (value: number | null): string | undefined =>
  value === null ? undefined : NUMBER_FORMATTER.format(value);

const Metric = ({ label, value }: { label: string; value: number | null }) => (
  <div className={styles.metric}>
    <p className={styles.caption}>{label}</p>
    <p className={styles.metricValue} title={formatMetricTitle(value)}>
      {formatMetric(value)}
    </p>
  </div>
);

const UsagePanel = ({
  summary,
  summaryMode,
  onSummaryModeChange,
  includedCredits,
  includedCreditsLoadState,
  prepaidBalanceDollars,
  subscription,
  onAddCredits,
}: {
  summary: MonthlyUsageQueryResult | null | undefined;
  summaryMode: SummaryMode;
  onSummaryModeChange: (mode: SummaryMode) => void;
  includedCredits: IncludedCreditsStatus | null;
  includedCreditsLoadState: IncludedCreditsLoadState;
  prepaidBalanceDollars: number | null | undefined;
  subscription: SubscriptionTier;
  onAddCredits: () => void;
}) => {
  const hasConsistentBalance = Boolean(
    includedCredits &&
    includedCredits.remaining <= includedCredits.total &&
    includedCredits.used <= includedCredits.total &&
    includedCredits.remaining + includedCredits.used === includedCredits.total,
  );
  const verifiedIncludedCredits =
    includedCredits &&
    Number.isFinite(includedCredits.remaining) &&
    includedCredits.remaining >= 0 &&
    Number.isFinite(includedCredits.used) &&
    includedCredits.used >= 0 &&
    Number.isFinite(includedCredits.total) &&
    includedCredits.total >= 0 &&
    hasConsistentBalance
      ? includedCredits
      : null;
  const verifiedResetAt =
    verifiedIncludedCredits?.resetAt &&
    Number.isFinite(Date.parse(verifiedIncludedCredits.resetAt))
      ? verifiedIncludedCredits.resetAt
      : null;
  const activityMetrics = summary
    ? [
        { label: "Tools", value: summary.toolOperations },
        { label: "Images", value: summary.imageOperations },
        { label: "Videos", value: summary.videoOperations },
      ].filter(
        (metric): metric is { label: string; value: number } =>
          metric.value !== null,
      )
    : [];
  const monthLabel = summary
    ? MONTH_FORMATTER.format(new Date(summary.periodStart))
    : summary === null
      ? "Usage data unavailable"
      : "This month";
  const canPurchaseAddOns = subscription === "pro" || subscription === "ultra";
  const prepaidBalanceIsKnown = typeof prepaidBalanceDollars === "number";
  const prepaidBalanceIsEmpty = prepaidBalanceDollars === 0;
  const prepaidBalanceIsLow =
    prepaidBalanceIsKnown && prepaidBalanceDollars <= 5;
  const includedCreditsAreExhausted = verifiedIncludedCredits?.remaining === 0;
  const includedCreditsAreLow = Boolean(
    verifiedIncludedCredits &&
    verifiedIncludedCredits.total > 0 &&
    verifiedIncludedCredits.remaining / verifiedIncludedCredits.total <= 0.1,
  );
  const creditsAreExhausted =
    canPurchaseAddOns && includedCreditsAreExhausted && prepaidBalanceIsEmpty;
  const creditsAreLow =
    canPurchaseAddOns &&
    !creditsAreExhausted &&
    includedCreditsAreLow &&
    prepaidBalanceIsLow;
  const addOnTitle = creditsAreExhausted
    ? "Credits exhausted"
    : creditsAreLow
      ? "Credits running low"
      : "Add-on credits";
  const addOnDescription = !canPurchaseAddOns
    ? "One-time credit packs are available with an active Pro or Max plan."
    : creditsAreExhausted
      ? "Add credits to keep Build and Studio running without waiting for your monthly reset."
      : creditsAreLow
        ? "Top up now so active model and tool runs can continue without interruption."
        : "Add one-time credits whenever you need more. They never expire.";

  return (
    <div className={styles.panel} data-ui="monthly-usage-panel">
      <header className={styles.header}>
        <h2 className={styles.title}>Monthly usage</h2>
        <p className={styles.caption}>{monthLabel}</p>
      </header>

      {verifiedIncludedCredits && typeof prepaidBalanceDollars === "number" && (
        <section className={styles.allowance} aria-label="Total available credits">
          <p className={styles.caption}>Available credits</p>
          <p className={styles.remaining} title={NUMBER_FORMATTER.format(verifiedIncludedCredits.remaining + Math.round(prepaidBalanceDollars * POINTS_PER_DOLLAR))}>
            {formatTokens(verifiedIncludedCredits.remaining + Math.round(prepaidBalanceDollars * POINTS_PER_DOLLAR))} <span>credits</span>
          </p>
          <p className={styles.caption}>Monthly allowance + add-on balance</p>
        </section>
      )}
      <section className={styles.allowance} aria-label="Included allowance">
        <p className={styles.caption}>Included credits</p>
        {includedCreditsLoadState === "loading" ? (
          <p className={styles.muted} aria-live="polite">
            Checking…
          </p>
        ) : verifiedIncludedCredits ? (
          <>
            <p
              className={styles.remaining}
              title={`${NUMBER_FORMATTER.format(verifiedIncludedCredits.remaining)} credits remaining`}
              aria-label={`${NUMBER_FORMATTER.format(verifiedIncludedCredits.remaining)} credits remaining`}
            >
              {COMPACT_NUMBER_FORMATTER.format(
                verifiedIncludedCredits.remaining,
              )}{" "}
              <span>credits left</span>
            </p>
            <AccountUsageMeter
              variant="bar"
              used={verifiedIncludedCredits.used}
              total={verifiedIncludedCredits.total}
            />
            <div className={styles.ledger}>
              <p>
                {COMPACT_NUMBER_FORMATTER.format(verifiedIncludedCredits.used)}
                {" used / "}
                {COMPACT_NUMBER_FORMATTER.format(verifiedIncludedCredits.total)}
                {" total"}
              </p>
              <p title={verifiedResetAt ? "Reset date in UTC" : undefined}>
                {verifiedResetAt
                  ? `Resets ${RESET_FORMATTER.format(new Date(verifiedResetAt))}`
                  : verifiedIncludedCredits.total > 0
                    ? "Included with your current plan"
                    : "No credits included with your current plan"}
              </p>
            </div>
          </>
        ) : (
          <p className={styles.muted}>Not available</p>
        )}
      </section>

      <section
        aria-label={addOnTitle}
        className={styles.credits}
        data-state={
          creditsAreExhausted ? "exhausted" : creditsAreLow ? "low" : "ready"
        }
      >
        <div className={styles.row}>
          <div>
            <p className={styles.caption}>Add-on balance · never expires</p>
            {prepaidBalanceDollars === undefined ? (
              <p className={styles.muted} aria-live="polite">
                Loading…
              </p>
            ) : prepaidBalanceDollars === null ? (
              <p className={styles.muted}>Not available</p>
            ) : (
              <p
                className={styles.balance}
                title={`${NUMBER_FORMATTER.format(Math.round(prepaidBalanceDollars * POINTS_PER_DOLLAR))} credits`}
              >
                {formatTokens(Math.round(prepaidBalanceDollars * POINTS_PER_DOLLAR))} credits
              </p>
            )}
          </div>
          {canPurchaseAddOns ? (
            <button
              type="button"
              onClick={onAddCredits}
              className={styles.action}
            >
              Add credits
            </button>
          ) : (
            <Link href="/upgrade" className={styles.action}>
              View plans
            </Link>
          )}
        </div>
        {creditsAreExhausted || creditsAreLow ? (
          <h3 className={styles.noticeTitle}>{addOnTitle}</h3>
        ) : null}
        {!canPurchaseAddOns || creditsAreExhausted || creditsAreLow ? (
          <p className={styles.creditNote}>{addOnDescription}</p>
        ) : null}
      </section>

      {summary === undefined ? (
        <div
          className={styles.loading}
          aria-live="polite"
          aria-label="Loading monthly usage"
        />
      ) : summary === null ? (
        <div className={styles.empty}>
          <p>Usage data unavailable</p>
          <p className={styles.caption}>
            Close this panel and try again in a moment.
          </p>
        </div>
      ) : !summary.hasUsage ? (
        <div className={styles.empty}>
          <p>No usage recorded</p>
          <p className={styles.caption}>
            Provider usage will appear after a saved model or tool run.
          </p>
        </div>
      ) : (
        <>
          <div className={styles.summary}>
            <Metric label="Total tokens" value={summary.totalTokens} />
            <p className={styles.caption}>
              {NUMBER_FORMATTER.format(summary.requestCount)} requests
            </p>
          </div>
          <button
            type="button"
            className={styles.disclosure}
            aria-expanded={summaryMode === "expanded"}
            aria-label={
              summaryMode === "expanded"
                ? "Hide expanded usage details"
                : "Show expanded usage details"
            }
            onClick={() =>
              onSummaryModeChange(
                summaryMode === "compact" ? "expanded" : "compact",
              )
            }
          >
            <span>
              {summaryMode === "expanded" ? "Hide details" : "Usage details"}
            </span>
            <ChevronDown
              aria-hidden
              className={cn(
                "size-3",
                summaryMode === "expanded" && "rotate-180",
              )}
            />
          </button>
          {summaryMode === "expanded" ? (
            <div className={styles.details}>
              {summary.dailyTokens?.some((value) => value > 0) ? (
                <div
                  data-testid="usage-daily-spark"
                  className={styles.sparkline}
                >
                  <Sparkline
                    data={summary.dailyTokens}
                    color="purple"
                    variant="gradient"
                    className="h-full w-full"
                  />
                </div>
              ) : null}
              <section aria-labelledby="usage-tokens-heading">
                <h3 id="usage-tokens-heading" className={styles.sectionTitle}>
                  Token breakdown
                </h3>
                <div className={styles.metrics}>
                  <Metric label="Input" value={summary.inputTokens} />
                  <Metric label="Output" value={summary.outputTokens} />
                  <Metric label="Cache read" value={summary.cacheReadTokens} />
                  <Metric
                    label="Cache write"
                    value={summary.cacheWriteTokens}
                  />
                  {summary.reasoningTokens !== null ? (
                    <Metric label="Reasoning" value={summary.reasoningTokens} />
                  ) : null}
                </div>
              </section>
              {activityMetrics.length > 0 ? (
                <section aria-labelledby="usage-activity-heading">
                  <h3
                    id="usage-activity-heading"
                    className={styles.sectionTitle}
                  >
                    Activity
                  </h3>
                  <div className={styles.metrics}>
                    {activityMetrics.map((metric) => (
                      <Metric
                        key={metric.label}
                        label={metric.label}
                        value={metric.value}
                      />
                    ))}
                  </div>
                </section>
              ) : null}
              {summary.models.length > 0 ? (
                <section aria-labelledby="usage-models-heading">
                  <h3 id="usage-models-heading" className={styles.sectionTitle}>
                    Models
                  </h3>
                  <div className={styles.list}>
                    {summary.models.map((model) => (
                      <div key={model.model} className={styles.row}>
                        <div className="min-w-0">
                          <p className="truncate">{model.model}</p>
                          <p className={styles.caption}>
                            {NUMBER_FORMATTER.format(model.requests)} requests
                          </p>
                        </div>
                        <span
                          className={cn(
                            styles.caption,
                            "shrink-0 tabular-nums",
                          )}
                          title={NUMBER_FORMATTER.format(model.tokens)}
                        >
                          {COMPACT_NUMBER_FORMATTER.format(model.tokens)} tokens
                        </span>
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}
              {summary.subagents !== null ? (
                <section aria-labelledby="usage-subagents-heading">
                  <h3
                    id="usage-subagents-heading"
                    className={styles.sectionTitle}
                  >
                    Subagents
                  </h3>
                  {summary.subagents.length === 0 ? (
                    <p className={styles.caption}>No subagent runs</p>
                  ) : (
                    <div className={styles.list}>
                      {summary.subagents.map((agent) => (
                        <div
                          key={`${agent.name}:${agent.role ?? ""}`}
                          className={styles.row}
                        >
                          <div className="min-w-0">
                            <p className="truncate">{agent.name}</p>
                            <p className={cn(styles.caption, "truncate")}>
                              {agent.role ?? "Role not recorded"}
                            </p>
                          </div>
                          <span
                            className={cn(
                              styles.caption,
                              "shrink-0 tabular-nums",
                            )}
                          >
                            {NUMBER_FORMATTER.format(agent.runs)} runs
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
};

type UsageTriggerProps = Omit<
  ComponentPropsWithoutRef<"button">,
  "children"
> & {
  isCollapsed: boolean;
  open: boolean;
  summary: MonthlyUsageQueryResult | null | undefined;
};

const UsageTrigger = forwardRef<HTMLButtonElement, UsageTriggerProps>(
  ({ isCollapsed, open, summary, className, ...buttonProps }, ref) => {
    const summaryLabel =
      summary === undefined
        ? open
          ? "Loading usage…"
          : "View details"
        : summary === null
          ? "Usage unavailable"
          : !summary.hasUsage
            ? "No usage recorded"
            : summary.totalTokens === null
              ? `${formatMetric(summary.toolOperations)} tool operations`
              : `${formatMetric(summary.totalTokens)} tokens`;

    return (
      <button
        {...buttonProps}
        ref={ref}
        type="button"
        aria-expanded={open}
        aria-label={
          isCollapsed
            ? `Monthly usage: ${summaryLabel}`
            : open
              ? "Close monthly usage"
              : "Open monthly usage"
        }
        title={isCollapsed ? "Monthly usage" : undefined}
        className={cn(
          "mb-1 flex w-full cursor-pointer items-center rounded-lg text-left transition-colors hover:bg-muted/70 focus-visible:outline-none",
          isCollapsed ? "justify-center p-2" : "gap-2.5 px-2 py-1.5",
          className,
        )}
      >
        <span className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border/70 bg-muted/30">
          <Gauge
            className="size-3.5 text-muted-foreground"
            aria-hidden="true"
          />
        </span>
        {isCollapsed ? null : (
          <>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-ui-label font-medium text-foreground">
                Monthly usage
              </span>
              <span
                className="block truncate text-ui-caption tabular-nums text-muted-foreground"
                aria-live="polite"
              >
                {summaryLabel}
              </span>
            </span>
            <ChevronRight
              className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${
                open ? "rotate-90" : ""
              }`}
              aria-hidden="true"
            />
          </>
        )}
      </button>
    );
  },
);

UsageTrigger.displayName = "UsageTrigger";

export const MonthlyUsageSummary = ({
  isCollapsed = false,
  subscription,
}: {
  isCollapsed?: boolean;
  subscription: SubscriptionTier;
}) => {
  const isMobile = useIsMobile() ?? false;
  const [open, setOpen] = useState(false);
  const [showAddOnCredits, setShowAddOnCredits] = useState(false);
  const [summaryMode, setSummaryMode] = useState<SummaryMode>("compact");
  const summaryRequestIdRef = useRef(0);
  const summaryAbortRef = useRef<AbortController | null>(null);
  const [summary, setSummary] = useState<
    MonthlyUsageQueryResult | null | undefined
  >(undefined);
  const extraUsage = useQuery(
    api.extraUsage.getExtraUsageSettings,
    // Pass the plan this card is already displaying, so the allowance shown
    // cannot contradict the plan name shown next to it.
    open ? mockBillingQueryArgs(subscription) : "skip",
  );
  const includedCreditsLoadState: IncludedCreditsLoadState =
    extraUsage === undefined
      ? "loading"
      : extraUsage === null
        ? "unavailable"
        : "loaded";
  const includedCredits = extraUsage?.includedCredits ?? null;
  const prepaidBalanceDollars =
    extraUsage === undefined
      ? undefined
      : typeof extraUsage?.balanceDollars === "number" &&
          Number.isFinite(extraUsage.balanceDollars) &&
          extraUsage.balanceDollars >= 0
        ? extraUsage.balanceDollars
        : null;

  const fetchMonthlySummary = useCallback(async () => {
    const requestId = ++summaryRequestIdRef.current;
    summaryAbortRef.current?.abort();
    const controller = new AbortController();
    summaryAbortRef.current = controller;
    setSummary(undefined);

    try {
      const response = await fetch("/api/usage/monthly", {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
        signal: controller.signal,
      });
      const result = (await response
        .json()
        .catch(() => null)) as MonthlyUsageApiResult | null;
      const values = [
        result?.periodStart,
        result?.periodEnd,
        result?.requestCount,
        result?.inputTokens,
        result?.outputTokens,
        result?.cacheReadTokens,
        result?.cacheWriteTokens,
        result?.totalTokens,
      ];
      if (
        !response.ok ||
        !result?.ok ||
        values.some(
          (value) =>
            typeof value !== "number" || !Number.isFinite(value) || value < 0,
        )
      ) {
        throw new Error("Usage summary unavailable");
      }
      if (requestId !== summaryRequestIdRef.current) return;

      const requestCount = result.requestCount!;
      const totalTokens = result.totalTokens!;
      const hasUsage = requestCount > 0 || totalTokens > 0;
      // The spark only draws from a verified series: bounded, finite,
      // non-negative. A malformed row degrades to "no spark", never NaN art.
      const dailyTokens =
        Array.isArray(result.dailyTokens) &&
        result.dailyTokens.length <= 31 &&
        result.dailyTokens.every(
          (value) =>
            typeof value === "number" && Number.isFinite(value) && value >= 0,
        )
          ? result.dailyTokens
          : undefined;
      setSummary({
        periodStart: result.periodStart!,
        periodEnd: result.periodEnd!,
        dailyTokens,
        hasUsage,
        requestCount,
        tokenSource: hasUsage ? "usage_logs" : null,
        inputTokens: result.inputTokens!,
        outputTokens: result.outputTokens!,
        cacheReadTokens: result.cacheReadTokens!,
        cacheWriteTokens: result.cacheWriteTokens!,
        totalTokens,
        reasoningTokens: null,
        toolOperations: null,
        imageOperations: null,
        videoOperations: null,
        models: [],
        subagents: null,
      });
    } catch {
      if (
        requestId === summaryRequestIdRef.current &&
        !controller.signal.aborted
      ) {
        setSummary(null);
      }
    } finally {
      if (summaryAbortRef.current === controller) {
        summaryAbortRef.current = null;
      }
    }
  }, []);

  useEffect(
    () => () => {
      summaryRequestIdRef.current += 1;
      summaryAbortRef.current?.abort();
    },
    [],
  );

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (nextOpen) {
        setSummaryMode("compact");
        void fetchMonthlySummary();
      } else {
        summaryRequestIdRef.current += 1;
        summaryAbortRef.current?.abort();
      }
      setOpen(nextOpen);
    },
    [fetchMonthlySummary],
  );

  const handleAddCredits = useCallback(() => {
    handleOpenChange(false);
    setShowAddOnCredits(true);
  }, [handleOpenChange]);

  const panel = useMemo(
    () => (
      <UsagePanel
        summary={summary}
        summaryMode={summaryMode}
        onSummaryModeChange={setSummaryMode}
        includedCredits={includedCredits}
        includedCreditsLoadState={includedCreditsLoadState}
        prepaidBalanceDollars={prepaidBalanceDollars}
        subscription={subscription}
        onAddCredits={handleAddCredits}
      />
    ),
    [
      prepaidBalanceDollars,
      summary,
      summaryMode,
      includedCredits,
      includedCreditsLoadState,
      subscription,
      handleAddCredits,
    ],
  );

  if (isMobile) {
    return (
      <>
        <Sheet open={open} onOpenChange={handleOpenChange}>
          <SheetTrigger asChild>
            <UsageTrigger
              isCollapsed={isCollapsed}
              open={open}
              summary={summary}
            />
          </SheetTrigger>
          <SheetContent
            side="bottom"
            className={cn(
              styles.sheet,
              "max-h-[80dvh] overflow-y-auto rounded-t-xl px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 motion-reduce:transition-none",
            )}
          >
            <SheetHeader className="sr-only">
              <SheetTitle>Monthly usage</SheetTitle>
              <SheetDescription>
                Usage tokens, activity, models, and subagents for this month.
              </SheetDescription>
            </SheetHeader>
            {panel}
          </SheetContent>
        </Sheet>
        <AddOnCreditsDialog
          open={showAddOnCredits}
          onOpenChange={setShowAddOnCredits}
        />
      </>
    );
  }

  return (
    <>
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>
          <UsageTrigger
            isCollapsed={isCollapsed}
            open={open}
            summary={summary}
          />
        </PopoverTrigger>
        <PopoverContent
          side="right"
          align="end"
          sideOffset={8}
          collisionPadding={12}
          className={cn(styles.popover, "motion-reduce:transition-none")}
        >
          {panel}
        </PopoverContent>
      </Popover>
      <AddOnCreditsDialog
        open={showAddOnCredits}
        onOpenChange={setShowAddOnCredits}
      />
    </>
  );
};
