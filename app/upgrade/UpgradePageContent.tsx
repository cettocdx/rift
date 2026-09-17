"use client";

import { useState } from "react";
import { mockBillingQueryArgs } from "@/lib/billing/mock-billing";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAction, useQuery } from "convex/react";
import { ArrowLeft } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { useAuth } from "@/app/hooks/useAuth";
import { RiftBrandLockup } from "@/components/icons/rift-brand-lockup";
import { AddOnCreditsDialog } from "@/app/components/extra-usage";
import { formatTokens } from "@/lib/billing/token-display";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

import { PLANS as PRICING_PLANS } from "@/lib/pricing/plans";
import { OPERATIONS } from "@/lib/operations/operations";
import { TOOLCHAIN } from "@/lib/workbench/toolchain";
import {
  X_BTN_FILLED,
  X_BTN_GHOST,
  X_CAPTION,
  X_CARD_TITLE,
  X_LABEL,
  X_NUMERAL,
  X_SECTION,
  X_TOKENS,
} from "@/app/components/landing-x/x-system";

type Tier = "free" | "pro" | "ultra";

/**
 * The plans, taken from the pricing module rather than typed again here.
 *
 * This file used to carry its own copy — "$39", "$129", "500,000 credits every
 * month" — written out beside the checkout it starts. That is the exact
 * failure lib/pricing/plans.ts exists to prevent, and it had already begun:
 * the shared module states the credit grant *with the dollars of metered usage
 * it buys*, derived from INCLUDED_CREDITS_BY_TIER ÷ POINTS_PER_DOLLAR, while
 * the copy here quoted a bare credit figure a buyer cannot price. The page
 * that takes the money was the one page advertising the weaker number.
 *
 * `PRICING_PLANS` is ordered Free, Pro, Max and the checkout needs the tier
 * key, so the two are zipped by index with the order asserted below rather
 * than assumed.
 */
const TIER_ORDER: Tier[] = ["free", "pro", "ultra"];

const PLANS = PRICING_PLANS.map((plan, i) => ({
  ...plan,
  tier: TIER_ORDER[i],
  featured: plan.highlight === true,
}));

const RANK: Record<Tier, number> = { free: 0, pro: 1, ultra: 2 };

/** A grey tick, for every feature that is not the flagship. */
function Tick() {
  return (
    <span
      aria-hidden
      className="mt-[7px] size-1 shrink-0 rounded-full bg-[var(--x-ink-30)]"
    />
  );
}

export function UpgradePageContent({ feature }: { feature?: string }) {
  const router = useRouter();
  const { user } = useAuth();
  const activeSubscription = useQuery(api.subscriptions.getActiveSubscription);
  const extraUsageSettings = useQuery(
    api.extraUsage.getExtraUsageSettings,
    mockBillingQueryArgs(),
  );

  const createSubscription = useAction(
    api.extraUsageActions.createLemonsqueezySubscription,
  );
  const [isUpgrading, setIsUpgrading] = useState<null | "pro" | "ultra">(null);
  const [showBuyDialog, setShowBuyDialog] = useState(false);

  const currentTier: Tier = activeSubscription
    ? activeSubscription.tier === "ultra"
      ? "ultra"
      : "pro"
    : "free";
  const isHackUpgrade = feature === "hack";
  /** The gate a visitor arrived through, still closed. */
  const showHackGate = isHackUpgrade && currentTier !== "ultra";

  const balancePoints = extraUsageSettings?.balancePoints ?? 0;
  const isBalanceLoading = extraUsageSettings === undefined;

  // Subscribe → LemonSqueezy hosted checkout (redirect to payment).
  const handleUpgrade = async (tier: "pro" | "ultra") => {
    if (!user) {
      router.push("/login?redirect=/upgrade");
      return;
    }
    setIsUpgrading(tier);
    try {
      const result = await createSubscription({
        tier,
        baseUrl: window.location.origin,
      });
      if (result.url) {
        window.location.assign(result.url);
      } else {
        toast.error(result.error || "Could not start checkout");
        setIsUpgrading(null);
      }
    } catch {
      toast.error("Could not start checkout");
      setIsUpgrading(null);
    }
  };

  return (
    /*
     * The landing's system, not the application's.
     *
     * This page is reached from two places — the pricing table on the public
     * site and the Hack Workbench gate inside the product — and it used to run
     * the app's dark theme in both cases. Coming from the landing that is an
     * inversion at exactly the moment a buyer is deciding; coming from the
     * product it is at least consistent. The landing wins the tie: this is a
     * page that sells, and every other page that sells is now white.
     */
    <div
      style={X_TOKENS}
      className="min-h-dvh bg-[var(--x-ground)] text-[var(--x-ink)] antialiased"
    >
      <header
        data-rift-native-titlebar="billing"
        data-tauri-drag-region
        className="mx-auto flex h-16 w-full max-w-[1080px] items-center justify-between border-b-[0.5px] border-b-[var(--x-line)] px-5"
      >
        <Link
          href="/"
          className="inline-flex items-center gap-2.5 rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--x-ink)]"
          aria-label="RIFT home"
        >
          <RiftBrandLockup decorative markSize={30} textSize={15} gap={10} />
        </Link>
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 rounded-md text-[14px] leading-5 text-[var(--x-ink-45)] transition-colors duration-150 hover:text-[var(--x-ink)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--x-ink)]"
        >
          <ArrowLeft className="size-3.5" />
          Back to app
        </Link>
      </header>

      <main
        className="mx-auto w-full max-w-[1080px] px-5 pb-24"
        aria-busy={isUpgrading !== null}
      >
        {/*
         * The claim.
         *
         * Left-aligned, at the landing's section step rather than centred at
         * 34px. A centred hero is what a marketing page opens with; this is
         * the page after the decision, and its job is to be read quickly.
         */}
        <div className="max-w-[640px] pb-12 pt-14 md:pt-16">
          <p className={X_LABEL}>
            {showHackGate ? "Hack Workbench" : "Plans"}
          </p>
          <h1
            // 26ch, not 20: at 20 the gate's heading broke as "Unlock Hack /
            // Workbench with Max", splitting the product's name across two
            // lines on the page selling it.
            className={`${X_SECTION} mt-5 max-w-[26ch] text-balance text-[var(--x-ink)]`}
          >
            {showHackGate
              ? "Unlock Hack Workbench with Max"
              : currentTier === "free"
                ? "Upgrade your plan"
                : "Manage your plan"}
          </h1>
          <p className={`${X_CAPTION} mt-5 max-w-[520px]`}>
            {showHackGate
              ? "The Workbench runs an authorised offensive toolchain in a container that is torn down after every pass. It is included with Max."
              : currentTier === "free"
                ? "Monthly credits and higher limits across Build and Studio. Cancel anytime."
                : `You're on ${currentTier === "ultra" ? "Max" : "Pro"}. Switch plans or top up credits below.`}
          </p>
        </div>

        {/*
         * What is behind the gate, when a visitor hit one.
         *
         * A gate that only says "this costs $129" asks for the money without
         * showing the goods. Every figure on this plate is read off the
         * product: the tools and categories are parsed from the manifest the
         * agent is handed (lib/workbench/toolchain.ts) and the operations are
         * lib/operations/operations.ts. It is also the one dark object on the
         * page, which is what the Workbench looks like in the product.
         */}
        {showHackGate ? (
          <div className="mb-12 overflow-hidden rounded-[20px] bg-black px-7 py-9 md:px-10">
            <p className="font-mono text-[12px] uppercase tracking-[0.06em] text-white/45">
              Included with Max
            </p>
            <p className="mt-4 max-w-[46ch] text-[18px] font-medium leading-[1.35] tracking-[-0.025em] text-white">
              A security lab that runs the tools, keeps the evidence, and
              verifies a finding before it reports it.
            </p>
            <dl className="mt-9 grid grid-cols-2 gap-y-7 border-t-[0.5px] border-t-white/12 pt-7 sm:grid-cols-4">
              {[
                { label: "Tools", value: String(TOOLCHAIN.total) },
                {
                  label: "Categories",
                  value: String(TOOLCHAIN.groups.length),
                },
                { label: "One-click ops", value: String(OPERATIONS.length) },
                { label: "Container", value: "Per pass" },
              ].map((stat) => (
                <div key={stat.label}>
                  <dt className="font-mono text-[11px] uppercase tracking-[0.06em] text-white/40">
                    {stat.label}
                  </dt>
                  <dd
                    className={`${X_NUMERAL} mt-2 text-[26px] text-white sm:text-[28px]`}
                  >
                    {stat.value}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        ) : null}

        {/*
         * The tiers, ruled rather than boxed.
         *
         * Three bordered cards on a white ground draw three frames the reader
         * has to look past; the landing's pricing table divides the same three
         * columns with a 0.5px rule and nothing else, and this is the same
         * table one click later. The chip that marked the featured tier keeps
         * its place, because on this page it carries a fact — which plan the
         * gate requires — rather than a preference.
         */}
        <div className="grid divide-y-[0.5px] divide-[var(--x-line)] border-t-[0.5px] border-t-[var(--x-line)] md:grid-cols-3 md:divide-x-[0.5px] md:divide-y-0">
          {PLANS.map((plan) => {
            const isCurrent = plan.tier === currentTier;
            const isUpgrade = RANK[plan.tier] > RANK[currentTier];
            const isFeatured = isHackUpgrade
              ? plan.tier === "ultra"
              : plan.featured;
            return (
              <div
                key={plan.tier}
                className="relative flex flex-col py-9 md:px-8 md:first:pl-0 md:last:pr-0"
              >
                <div className="flex items-baseline justify-between gap-4">
                  <span className={`${X_CARD_TITLE} text-[var(--x-ink)]`}>
                    {plan.name}
                  </span>
                  {isCurrent ? (
                    <span className={X_LABEL}>Current plan</span>
                  ) : isFeatured ? (
                    <span
                      className={cn(
                        X_LABEL,
                        // The gate's requirement is a fact about the purchase,
                        // so it carries the flagship accent the Hack line does
                        // in the pricing table. "Most popular" is an opinion
                        // and stays in the quiet label tone.
                        isHackUpgrade && "text-[var(--x-live)]",
                      )}
                    >
                      {isHackUpgrade ? "Required for Hack" : "Most popular"}
                    </span>
                  ) : null}
                </div>

                <p className="mt-7 flex items-baseline gap-2">
                  <span
                    className={`${X_NUMERAL} text-[44px] text-[var(--x-ink)]`}
                  >
                    {plan.price}
                  </span>
                  <span className={X_CAPTION}>{plan.cadence}</span>
                </p>
                <p className={`${X_CAPTION} mt-4`}>{plan.blurb}</p>

                <ul className="mt-8 flex flex-1 flex-col gap-3">
                  {plan.features.map((f) => {
                    // The one line a buyer arriving from the gate is scanning
                    // for. Same treatment as the landing's pricing table.
                    const flagship = /hack workbench/i.test(f);
                    return (
                      <li key={f} className="flex gap-3">
                        {flagship ? (
                          <span
                            aria-hidden
                            className="mt-[3px] flex size-4 shrink-0 items-center justify-center rounded-full bg-[var(--x-live)] text-[10px] font-bold text-white"
                          >
                            ★
                          </span>
                        ) : (
                          <Tick />
                        )}
                        <span
                          className={
                            flagship
                              ? "text-[14px] font-medium leading-[21px] tracking-[-0.025em] text-[var(--x-ink)]"
                              : "text-[14px] leading-[21px] text-[var(--x-ink-80)]"
                          }
                        >
                          {f}
                        </span>
                      </li>
                    );
                  })}
                </ul>

                {/* `mt-auto` on the wrapper, not the pill: the columns carry
                    different numbers of features, and a button that sits
                    wherever its own list ended makes the row look unaligned. */}
                <div className="mt-auto pt-9">
                  {plan.tier === "free" || isCurrent ? (
                    <button
                      type="button"
                      disabled
                      className={`${X_BTN_GHOST} w-full cursor-not-allowed justify-center opacity-45`}
                    >
                      {isCurrent
                        ? plan.tier === "free"
                          ? "Your plan"
                          : "Current plan"
                        : "Included"}
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={isUpgrading !== null}
                      onClick={() =>
                        handleUpgrade(plan.tier as "pro" | "ultra")
                      }
                      className={cn(
                        isFeatured ? X_BTN_FILLED : X_BTN_GHOST,
                        "w-full justify-center disabled:cursor-not-allowed disabled:opacity-45",
                      )}
                    >
                      {isUpgrading === plan.tier
                        ? "Redirecting…"
                        : isHackUpgrade && plan.tier === "ultra"
                          ? "Get Max for Hack Workbench"
                          : isUpgrade
                            ? `Get ${plan.name}`
                            : `Switch to ${plan.name}`}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Add-on credits — they stack on top of the plan's monthly allowance */}
        <div className="mt-2 flex flex-col gap-5 border-t-[0.5px] border-t-[var(--x-line)] py-9 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[15px] font-medium leading-[22px] tracking-[-0.025em] text-[var(--x-ink)]">
              Add-on credits
            </p>
            <p className={`${X_CAPTION} mt-2 max-w-[62ch]`}>
              {currentTier === "free"
                ? "Add-on credits stack on top of a plan's monthly allowance. Pick a plan above, then top up whenever you need more."
                : "Stack extra credits on top of your monthly allowance. They don't expire, and bigger packs include bonus credits."}{" "}
              <span className="whitespace-nowrap">
                Balance:{" "}
                <span
                  aria-live="polite"
                  className="tabular-nums text-[var(--x-ink)]"
                >
                  {isBalanceLoading
                    ? "Loading credits"
                    : `${formatTokens(balancePoints)} credits`}
                </span>
                .
              </span>
            </p>
          </div>
          <button
            type="button"
            className={`${X_BTN_GHOST} shrink-0 disabled:cursor-not-allowed disabled:opacity-45`}
            disabled={currentTier === "free"}
            title={
              currentTier === "free"
                ? "Add-on credits require an active Pro or Max plan"
                : undefined
            }
            onClick={() => {
              if (!user) {
                router.push("/login?redirect=/upgrade");
                return;
              }
              // Add-ons are a paid-plan perk — free users must subscribe first.
              if (currentTier === "free") return;
              setShowBuyDialog(true);
            }}
          >
            {currentTier === "free" ? "Pro or Max only" : "Add credits"}
          </button>
        </div>

        <p
          className={`${X_CAPTION} border-t-[0.5px] border-t-[var(--x-line)] pt-6 text-[13px]`}
        >
          Payments are processed by LemonSqueezy, our merchant of record. Cancel
          or change your plan anytime.
        </p>
      </main>

      <AddOnCreditsDialog
        open={showBuyDialog}
        onOpenChange={setShowBuyDialog}
      />
    </div>
  );
}
