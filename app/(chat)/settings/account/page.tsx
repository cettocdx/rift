import type { Metadata } from "next";
import { SettingsPageHeader } from "@/app/components/settings/SettingsShell";
import { AccountSection } from "@/app/components/settings/sections/AccountSection";

export const metadata: Metadata = {
  title: "Account & organization settings | RIFT",
  description: "Account identity, organization, and account deletion.",
};

export default function AccountSettingsPage() {
  return (
    <>
      <SettingsPageHeader
        title="Account & organization"
        description="Identity, team, and account deletion"
      />
      <AccountSection />
    </>
  );
}
