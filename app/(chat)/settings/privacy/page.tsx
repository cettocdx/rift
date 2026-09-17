import type { Metadata } from "next";
import { SettingsPageHeader } from "@/app/components/settings/SettingsShell";
import { PrivacySection } from "@/app/components/settings/sections/PrivacySection";

export const metadata: Metadata = {
  title: "Privacy & security settings | RIFT",
  description: "Shared chats, stored data, and destructive account actions.",
};

export default function PrivacySettingsPage() {
  return (
    <>
      <SettingsPageHeader
        title="Privacy & security"
        description="Shared chats, data, and destructive actions"
      />
      <PrivacySection />
    </>
  );
}
