"use client";

import { ExtraUsageSection } from "@/app/components/ExtraUsageSection";
import { MonthlyUsageSummary } from "@/app/components/usage/MonthlyUsageSummary";
import { useGlobalState } from "@/app/contexts/GlobalState";

export function BillingSection() {
  const { subscription } = useGlobalState();
  return (
    <div className="space-y-6">
      <MonthlyUsageSummary subscription={subscription} />
      <ExtraUsageSection />
    </div>
  );
}
