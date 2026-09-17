import type { Metadata } from "next";
import { SettingsPageHeader } from "@/app/components/settings/SettingsShell";
import { ApiKeysSection } from "@/app/components/settings/sections/ApiKeysSection";

export const metadata: Metadata = {
  title: "API keys settings | RIFT",
  description: "Create and revoke RIFT API keys for the terminal and scripts.",
};

export default function ApiKeysSettingsPage() {
  return (
    <>
      <SettingsPageHeader
        title="API keys"
        description="RIFT API access for the terminal and scripts"
      />
      <ApiKeysSection />
    </>
  );
}
