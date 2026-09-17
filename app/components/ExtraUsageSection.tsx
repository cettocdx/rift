"use client";

import { useState } from "react";
import { mockBillingQueryArgs } from "@/lib/billing/mock-billing";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { formatTokens } from "@/lib/billing/token-display";
import { getFreeRequestLimit } from "@/lib/rate-limit/free-config";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import {
  AddOnCreditsDialog,
  TurnOffExtraUsageDialog,
  AdjustSpendingLimitDialog,
  AutoReloadDialog,
} from "@/app/components/extra-usage";
import { Coins } from "lucide-react";
import { cn } from "@/lib/utils";

const ExtraUsageSection = () => {
  // User customization for extra usage enabled flag
  const userCustomization = useQuery(
    api.userCustomization.getUserCustomization,
  );
  const saveUserCustomization = useMutation(
    api.userCustomization.saveUserCustomization,
  );

  // Extra usage settings (balance and auto-reload config)
  const extraUsageSettings = useQuery(
    api.extraUsage.getExtraUsageSettings,
    mockBillingQueryArgs(),
  );
  const updateExtraUsageSettings = useMutation(
    api.extraUsage.updateExtraUsageSettings,
  );

  // Convex actions. Card payments + subscriptions now go through LemonSqueezy
  // (merchant of record, handles VAT). getPaymentStatus is still used to gate
  // auto-reload (which uses the saved Stripe card).
  const getPaymentStatus = useAction(api.extraUsageActions.getPaymentStatus);
  const createLemonsqueezySubscription = useAction(
    api.extraUsageActions.createLemonsqueezySubscription,
  );
  const activeSubscription = useQuery(api.subscriptions.getActiveSubscription);

  // Loading states
  const [isTogglingExtraUsage, setIsTogglingExtraUsage] = useState(false);
  const [isUpgrading, setIsUpgrading] = useState<null | "pro" | "ultra">(null);
  const [isSavingSettings, setIsSavingSettings] = useState(false);

  // Dialog states
  const [showTurnOffDialog, setShowTurnOffDialog] = useState(false);
  const [showSpendingLimitDialog, setShowSpendingLimitDialog] = useState(false);
  const [showAutoReloadDialog, setShowAutoReloadDialog] = useState(false);
  const [showAddOnCreditsDialog, setShowAddOnCreditsDialog] = useState(false);

  // Extra usage toggle handler
  const handleToggleExtraUsage = async (enabled: boolean) => {
    if (isTogglingExtraUsage) return;

    // If turning off, show confirmation dialog
    if (!enabled) {
      setShowTurnOffDialog(true);
      return;
    }

    setIsTogglingExtraUsage(true);
    try {
      // Check if user has a valid payment method before enabling
      const paymentStatus = await getPaymentStatus();

      if (!paymentStatus.hasPaymentMethod) {
        toast.error(
          "Please add a payment method in the billing portal before enabling extra usage.",
        );
        setIsTogglingExtraUsage(false);
        return;
      }

      await saveUserCustomization({ extra_usage_enabled: true });
      toast.success("Extra usage enabled");
    } catch (error) {
      console.error("Failed to toggle extra usage:", error);
      toast.error("Failed to update extra usage setting");
    } finally {
      setIsTogglingExtraUsage(false);
    }
  };

  // Confirm turn off extra usage
  const handleConfirmTurnOff = async () => {
    setIsTogglingExtraUsage(true);
    try {
      await saveUserCustomization({ extra_usage_enabled: false });
      toast.success("Extra usage disabled");
      setShowTurnOffDialog(false);
    } catch (error) {
      console.error("Failed to turn off extra usage:", error);
      toast.error("Failed to disable extra usage");
    } finally {
      setIsTogglingExtraUsage(false);
    }
  };

  // Subscribe to / upgrade a plan (Pro or Max → "ultra") via LemonSqueezy.
  const handleUpgrade = async (tier: "pro" | "ultra") => {
    setIsUpgrading(tier);
    try {
      const result = await createLemonsqueezySubscription({
        tier,
        baseUrl: window.location.origin,
      });
      if (result.url) {
        window.location.href = result.url;
      } else {
        toast.error(result.error || "Could not start checkout");
        setIsUpgrading(null);
      }
    } catch (error) {
      console.error("Failed to start subscription checkout:", error);
      toast.error("Could not start checkout");
      setIsUpgrading(null);
    }
  };

  // Save auto-reload settings from dialog
  const handleSaveAutoReload = async (
    thresholdDollars: number,
    amountDollars: number,
  ) => {
    setIsSavingSettings(true);
    try {
      await updateExtraUsageSettings({
        autoReloadEnabled: true,
        autoReloadThresholdDollars: thresholdDollars,
        autoReloadAmountDollars: amountDollars,
      });
      toast.success("Auto-reload enabled");
      setShowAutoReloadDialog(false);
    } catch (error) {
      console.error("Failed to save auto-reload settings:", error);
      toast.error("Failed to save auto-reload settings");
    } finally {
      setIsSavingSettings(false);
    }
  };

  // Turn off auto-reload from dialog
  const handleTurnOffAutoReload = async () => {
    setIsSavingSettings(true);
    try {
      await updateExtraUsageSettings({ autoReloadEnabled: false });
      toast.success("Auto-reload disabled");
      setShowAutoReloadDialog(false);
    } catch (error) {
      console.error("Failed to turn off auto-reload:", error);
      toast.error("Failed to turn off auto-reload");
    } finally {
      setIsSavingSettings(false);
    }
  };

  // Save monthly spending limit handler
  const handleSaveSpendingLimit = async (limitDollars: number | null) => {
    setIsSavingSettings(true);
    try {
      await updateExtraUsageSettings({
        monthlyCapDollars: limitDollars,
      });
      toast.success(
        limitDollars ? "Spending limit updated" : "Spending limit removed",
      );
      setShowSpendingLimitDialog(false);
    } catch (error) {
      console.error("Failed to save spending limit:", error);
      toast.error("Failed to update spending limit");
    } finally {
      setIsSavingSettings(false);
    }
  };

  const balancePoints = extraUsageSettings?.balancePoints ?? 0;
  const autoReloadEnabled = extraUsageSettings?.autoReloadEnabled ?? false;
  const autoReloadDisabledReason = extraUsageSettings?.autoReloadDisabledReason;
  const monthlyCapDollars = extraUsageSettings?.monthlyCapDollars;
  const monthlySpentDollars = extraUsageSettings?.monthlySpentDollars ?? 0;
  const effectiveCapDollars = monthlyCapDollars;

  // Get color class based on usage percentage (matches UsageTab)
  const getUsageColorClass = (percentage: number): string => {
    if (percentage >= 90) return "bg-red-500";
    if (percentage >= 70) return "bg-orange-500";
    return "bg-primary";
  };

  const isLoading =
    userCustomization === undefined ||
    extraUsageSettings === undefined ||
    activeSubscription === undefined;

  if (isLoading) {
    return (
      <section
        data-testid="extra-usage-loading"
        role="status"
        aria-label="Loading usage and billing settings"
        aria-busy="true"
        className="space-y-4"
      >
        <span className="sr-only">Loading usage and billing settings</span>
        <div className="space-y-2 border-b border-border pb-5">
          <div className="h-3 w-16 animate-pulse rounded bg-muted motion-reduce:animate-none" />
          <div className="h-3 w-3/4 animate-pulse rounded bg-muted motion-reduce:animate-none" />
          <div className="grid gap-3 pt-2 sm:grid-cols-3">
            {[0, 1, 2].map((item) => (
              <div
                key={item}
                aria-hidden
                className="h-32 animate-pulse rounded-md border border-border bg-muted/35 motion-reduce:animate-none"
              />
            ))}
          </div>
        </div>
        <div className="h-10 animate-pulse rounded-md bg-muted/35 motion-reduce:animate-none" />
      </section>
    );
  }

  const currentTier: "free" | "pro" | "ultra" = activeSubscription
    ? activeSubscription.tier === "ultra"
      ? "ultra"
      : "pro"
    : "free";
  const canPurchaseAddOns =
    activeSubscription?.tier === "pro" || activeSubscription?.tier === "ultra";
  const includedCredits = extraUsageSettings?.includedCredits;
  const includedCreditsAreExhausted = includedCredits?.remaining === 0;
  const includedCreditsAreLow = Boolean(
    includedCredits &&
    includedCredits.total > 0 &&
    includedCredits.remaining / includedCredits.total <= 0.1,
  );
  const creditsAreExhausted =
    canPurchaseAddOns && includedCreditsAreExhausted && balancePoints === 0;
  const creditsAreLow =
    canPurchaseAddOns &&
    !creditsAreExhausted &&
    includedCreditsAreLow &&
    balancePoints <= 50_000;
  const addOnTitle = creditsAreExhausted
    ? "Credits exhausted"
    : creditsAreLow
      ? "Credits running low"
      : "Add-on credits";
  const addOnDescription = !canPurchaseAddOns
    ? "One-time credit packs become available after you activate Pro or Max."
    : creditsAreExhausted
      ? "Add credits now to keep Build and Studio running without waiting for the monthly reset."
      : creditsAreLow
        ? "Top up before active model and tool runs reach your remaining balance."
        : "Add one-time credits on top of your monthly allowance. They never expire.";

  return (
    <>
      <section
        data-testid="extra-usage-section"
        className="flex flex-col gap-6"
      >
        {/* Plans — subscribe/upgrade via LemonSqueezy */}
        {(() => {
          const PLANS = [
            {
              tier: "free" as const,
              name: "Free",
              price: "$0",
              cadence: "",
              features: [
                `${getFreeRequestLimit()} questions per day`,
                "1 full agent run each month",
                "Build and Studio access",
                "Isolated cloud sandbox",
              ],
            },
            {
              tier: "pro" as const,
              name: "Pro",
              price: "$39",
              cadence: "/mo",
              features: [
                "500,000 credits every month",
                "All Build and Studio models",
                "Unlimited chats & projects",
                "Priority sandboxes",
              ],
            },
            {
              tier: "ultra" as const,
              name: "Max",
              price: "$129",
              cadence: "/mo",
              features: [
                "Exclusive Hack Workbench access",
                "1,800,000 credits every month",
                "Personal API keys",
                "Highest limits & priority",
                "Early access to new tools",
              ],
            },
          ];
          const rank = { free: 0, pro: 1, ultra: 2 } as const;
          return (
            <div className="w-full flex flex-col gap-3 border-b border-border pb-6">
              <div className="flex flex-col gap-0.5">
                <p className="text-sm font-medium">Plan</p>
                <p className="text-sm text-muted-foreground">
                  {currentTier === "free"
                    ? "You're on the free plan. Upgrade for monthly Build and Studio credits; Hack Workbench is exclusive to Max."
                    : `You're on ${currentTier === "ultra" ? "Max" : "Pro"}. Thanks for supporting RIFT.`}
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                {PLANS.map((plan) => {
                  const isCurrent = plan.tier === currentTier;
                  const isUpgrade = rank[plan.tier] > rank[currentTier];
                  const featured = plan.tier === "pro";
                  return (
                    <div
                      key={plan.tier}
                      className={`relative flex flex-col rounded-xl border p-4 ${
                        isCurrent
                          ? "border-primary/60 bg-primary/[0.06]"
                          : featured
                            ? "border-primary/30 bg-card"
                            : "border-border bg-card"
                      }`}
                    >
                      {isCurrent && (
                        <span className="absolute -top-2 left-4 rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary-foreground">
                          Current
                        </span>
                      )}
                      <div className="flex items-baseline justify-between">
                        <span className="text-sm font-semibold">
                          {plan.name}
                        </span>
                        <span className="text-sm text-muted-foreground">
                          <span className="font-semibold text-foreground">
                            {plan.price}
                          </span>
                          {plan.cadence}
                        </span>
                      </div>
                      <ul className="mt-3 flex flex-1 flex-col gap-1.5">
                        {plan.features.map((f) => (
                          <li
                            key={f}
                            className="flex items-start gap-1.5 text-[12.5px] text-muted-foreground"
                          >
                            <span className="mt-1.5 size-1 shrink-0 rounded-full bg-primary" />
                            {f}
                          </li>
                        ))}
                      </ul>
                      {plan.tier !== "free" && isUpgrade && (
                        <Button
                          variant={featured ? "default" : "outline"}
                          size="sm"
                          className="mt-4"
                          disabled={isUpgrading !== null}
                          onClick={() => handleUpgrade(plan.tier)}
                          aria-label={`Upgrade to ${plan.name}`}
                        >
                          {isUpgrading === plan.tier
                            ? "Redirecting…"
                            : currentTier === "free"
                              ? `Upgrade to ${plan.name}`
                              : `Switch to ${plan.name}`}
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {/* The monthly allowance, shown.
            This number was computed and then only ever used to decide whether
            to colour a warning — so the page told you a plan "includes
            1,800,000 credits a month" and never once said how many of them you
            still had. */}
        {includedCredits ? (
          <section
            aria-labelledby="billing-included-credits-heading"
            className="rounded-lg border border-border/80 bg-background p-4"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h3
                id="billing-included-credits-heading"
                className="text-[14px] font-semibold text-foreground"
              >
                Included credits
              </h3>
              <p
                data-testid="included-credits-remaining"
                className="text-[13px] tabular-nums text-foreground"
              >
                {formatTokens(includedCredits.remaining)}
                <span className="text-muted-foreground">
                  {" "}
                  of {formatTokens(includedCredits.total)} left
                </span>
              </p>
            </div>
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={includedCredits.total}
              aria-valuenow={includedCredits.remaining}
              aria-label="Included credits remaining"
              className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted"
            >
              <div
                className={cn(
                  "h-full rounded-full transition-[width] duration-500",
                  includedCreditsAreExhausted
                    ? "bg-destructive"
                    : includedCreditsAreLow
                      ? "bg-foreground/60"
                      : "bg-foreground",
                )}
                style={{
                  width: `${
                    includedCredits.total > 0
                      ? Math.max(
                          0,
                          Math.min(
                            100,
                            (includedCredits.remaining /
                              includedCredits.total) *
                              100,
                          ),
                        )
                      : 0
                  }%`,
                }}
              />
            </div>
            <p className="mt-2 text-[12px] leading-4 text-muted-foreground">
              {formatTokens(includedCredits.used)} used this cycle. Resets with
              your monthly allowance; add-on credits below never expire.
            </p>
          </section>
        ) : null}

        <section
          aria-labelledby="billing-add-on-credits-heading"
          className={cn(
            "flex flex-col gap-4 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between",
            creditsAreExhausted
              ? "border-destructive/35 bg-destructive/[0.07]"
              : creditsAreLow
                ? "border-foreground/20 bg-muted/35"
                : "border-border/80 bg-card/[0.16]",
          )}
        >
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-background/60">
              <Coins
                className={cn(
                  "size-4",
                  creditsAreExhausted
                    ? "text-destructive"
                    : "text-muted-foreground",
                )}
                aria-hidden="true"
              />
            </span>
            <div className="min-w-0">
              <h3
                id="billing-add-on-credits-heading"
                className="text-[14px] font-semibold text-foreground"
              >
                {addOnTitle}
              </h3>
              <p className="mt-1 max-w-xl text-[13px] leading-5 text-muted-foreground">
                {addOnDescription}
              </p>
              <p className="mt-1.5 text-[12px] tabular-nums text-foreground/80">
                Add-on balance: {formatTokens(balancePoints)} credits
              </p>
            </div>
          </div>
          <Button
            type="button"
            size="sm"
            variant={creditsAreExhausted ? "default" : "outline"}
            className="shrink-0 whitespace-nowrap active:translate-y-px"
            disabled={!canPurchaseAddOns}
            title={
              canPurchaseAddOns
                ? undefined
                : "Add-on credits require an active Pro or Max plan"
            }
            onClick={() => setShowAddOnCreditsDialog(true)}
          >
            {canPurchaseAddOns ? "Add credits" : "Pro or Max required"}
          </Button>
        </section>

        {/* Toggle Row */}
        <div className="w-full min-w-0 flex flex-row gap-x-8 gap-y-3 justify-between items-center">
          <div className="w-full min-w-0 flex flex-row gap-4 items-center">
            <div className="flex flex-col gap-1.5 min-w-0">
              <p className="text-sm">
                Turn on auto-reload to top up tokens automatically when you run
                low.{" "}
                <a
                  href="https://help.rift.co/en/articles/13455916-extra-usage-for-paid-rift-plans"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline underline underline-offset-[3px] text-muted-foreground hover:text-foreground"
                  aria-label="Learn more about extra usage"
                >
                  Learn more
                </a>
              </p>
            </div>
          </div>
          <Switch
            checked={userCustomization?.extra_usage_enabled ?? false}
            onCheckedChange={handleToggleExtraUsage}
            disabled={isTogglingExtraUsage}
            aria-label="Toggle extra usage"
          />
        </div>

        {/* Enabled State - Show additional controls */}
        {userCustomization?.extra_usage_enabled && (
          <>
            {/* Monthly Spending Progress */}
            {effectiveCapDollars != null && effectiveCapDollars > 0 && (
              <div className="w-full flex flex-col gap-2">
                <div className="w-full flex flex-row gap-x-8 gap-y-3 justify-between items-center flex-wrap">
                  <div className="flex flex-col gap-1.5 min-w-0">
                    <p className="text-sm">
                      ${monthlySpentDollars.toFixed(2)} spent
                    </p>
                    <p className="text-sm text-muted-foreground whitespace-nowrap">
                      Resets{" "}
                      {new Date(
                        new Date().getFullYear(),
                        new Date().getMonth() + 1,
                        1,
                      ).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                      })}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 md:flex-1 md:max-w-xl">
                    <div className="flex-1">
                      <div className="relative h-2 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className={`h-full w-full origin-left transition-transform duration-500 ease-linear motion-reduce:transition-none ${getUsageColorClass((monthlySpentDollars / effectiveCapDollars) * 100)}`}
                          style={{
                            transform: `scaleX(${Math.min(100, (monthlySpentDollars / effectiveCapDollars) * 100) / 100})`,
                          }}
                        />
                      </div>
                    </div>
                    <p className="text-sm text-muted-foreground whitespace-nowrap text-right">
                      {Math.min(
                        100,
                        Math.round(
                          (monthlySpentDollars / effectiveCapDollars) * 100,
                        ),
                      )}
                      % used
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Monthly Spending Limit Row */}
            <div className="w-full flex flex-row gap-x-8 gap-y-3 justify-between items-center">
              <div className="flex flex-col gap-1.5 min-w-0">
                <p className="text-sm">
                  {effectiveCapDollars != null
                    ? `$${effectiveCapDollars.toFixed(2)}`
                    : "Unlimited"}
                </p>
                <p className="text-sm text-muted-foreground">
                  Monthly spending limit
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowSpendingLimitDialog(true)}
                disabled={isSavingSettings}
                className="min-w-[5rem]"
                aria-label="Adjust spending limit"
                tabIndex={0}
              >
                Adjust
              </Button>
            </div>

            {/* Current Balance Row */}
            <div className="w-full flex flex-row gap-x-8 gap-y-3 justify-between items-center flex-wrap">
              <div className="flex flex-col gap-1.5 min-w-0">
                <p className="text-sm tabular-nums">
                  {formatTokens(balancePoints, { compact: false })} tokens
                </p>
                <p className="text-sm text-muted-foreground whitespace-nowrap">
                  Token balance
                  <span className="mx-1">·</span>
                  <button
                    type="button"
                    onClick={() => setShowAutoReloadDialog(true)}
                    className={
                      autoReloadEnabled
                        ? "text-success underline hover:text-success/80"
                        : "text-destructive underline hover:text-destructive/80"
                    }
                    aria-label="Configure auto-reload"
                    tabIndex={0}
                  >
                    Auto-reload {autoReloadEnabled ? "on" : "off"}
                  </button>
                </p>
                {!autoReloadEnabled && autoReloadDisabledReason && (
                  <div
                    role="alert"
                    className="mt-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                  >
                    Auto-reload was turned off because your card kept failing
                    {`: ${autoReloadDisabledReason}`}. Update your payment
                    method, then turn auto-reload back on.
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </section>

      {/* Dialogs */}
      <TurnOffExtraUsageDialog
        open={showTurnOffDialog}
        onOpenChange={setShowTurnOffDialog}
        onConfirm={handleConfirmTurnOff}
        isLoading={isTogglingExtraUsage}
      />

      <AdjustSpendingLimitDialog
        open={showSpendingLimitDialog}
        onOpenChange={setShowSpendingLimitDialog}
        onSave={handleSaveSpendingLimit}
        isLoading={isSavingSettings}
        currentLimitDollars={monthlyCapDollars ?? null}
      />

      <AutoReloadDialog
        open={showAutoReloadDialog}
        onOpenChange={setShowAutoReloadDialog}
        onSave={handleSaveAutoReload}
        onTurnOff={handleTurnOffAutoReload}
        onCancel={() => setShowAutoReloadDialog(false)}
        isLoading={isSavingSettings}
        isEnabled={autoReloadEnabled}
        currentThresholdDollars={
          extraUsageSettings?.autoReloadThresholdDollars ?? null
        }
        currentAmountDollars={
          extraUsageSettings?.autoReloadAmountDollars ?? null
        }
      />

      <AddOnCreditsDialog
        open={showAddOnCreditsDialog}
        onOpenChange={setShowAddOnCreditsDialog}
      />
    </>
  );
};

export { ExtraUsageSection };
