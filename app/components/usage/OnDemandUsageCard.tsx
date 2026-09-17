"use client";

import { useQuery } from "convex/react";
import { mockBillingQueryArgs } from "@/lib/billing/mock-billing";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { useSettingsNavigation } from "@/app/components/settings/useSettingsNavigation";
import type { SubscriptionTier } from "@/types";

interface OnDemandUsageCardProps {
  subscription: SubscriptionTier;
}

const OnDemandUsageCard = ({ subscription }: OnDemandUsageCardProps) => {
  const { hrefFor } = useSettingsNavigation();
  const extraUsageSettings = useQuery(
    api.extraUsage.getExtraUsageSettings,
    mockBillingQueryArgs(subscription),
  );
  const userCustomization = useQuery(
    api.userCustomization.getUserCustomization,
  );

  const extraUsageEnabled = userCustomization?.extra_usage_enabled ?? false;
  const monthlyCapDollars = extraUsageSettings?.monthlyCapDollars;
  const monthlySpentDollars = extraUsageSettings?.monthlySpentDollars ?? 0;
  const balanceDollars = extraUsageSettings?.balanceDollars ?? 0;

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <p className="text-xs text-muted-foreground">
        On-Demand Usage
        {subscription === "team" ? " (Team)" : ""}
      </p>
      {extraUsageEnabled ? (
        <>
          <div className="flex items-baseline gap-1.5">
            <span className="text-2xl font-medium tabular-nums">
              ${monthlySpentDollars.toFixed(2)}
            </span>
            {monthlyCapDollars ? (
              <span className="text-sm text-muted-foreground">
                / ${monthlyCapDollars.toFixed(2)}
              </span>
            ) : (
              <span className="text-sm text-muted-foreground">/ No limit</span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Pay for extra usage beyond your plan limits.
          </p>
          <div className="text-xs text-muted-foreground">
            ${balanceDollars.toFixed(2)} balance
            {extraUsageSettings?.autoReloadEnabled && (
              <span> · Auto-reload on</span>
            )}
          </div>
        </>
      ) : (
        <>
          <div className="flex items-baseline gap-1.5">
            <span className="text-2xl font-medium tabular-nums text-muted-foreground">
              Off
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            Pay for extra usage beyond your plan limits.
          </p>
          <div className="flex items-center gap-3">
            <Button asChild variant="outline" size="sm" className="h-7 text-xs">
              <Link href={hrefFor("billing")} aria-label="Set up extra usage">
                Set Limit
              </Link>
            </Button>
            <span className="text-xs text-muted-foreground">Off</span>
          </div>
        </>
      )}
    </div>
  );
};

export { OnDemandUsageCard };
