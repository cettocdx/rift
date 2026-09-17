import type { Metadata } from "next";
import { SettingsPageHeader } from "@/app/components/settings/SettingsShell";
import { BillingSection } from "@/app/components/settings/sections/BillingSection";

export const metadata: Metadata = {
  title: "Usage & billing settings | RIFT",
  description: "Plan, balance, spending limits, and automatic top-ups.",
};

export default function BillingSettingsPage() {
  return (
    <>
      <SettingsPageHeader
        title="Usage & billing"
        description="Plan, balance, limits, and auto-reload"
      />
      <BillingSection />
    </>
  );
}
