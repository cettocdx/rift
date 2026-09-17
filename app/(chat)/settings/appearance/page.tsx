import type { Metadata } from "next";
import { SettingsPageHeader } from "@/app/components/settings/SettingsShell";
import { AppearanceSection } from "@/app/components/settings/sections/AppearanceSection";

export const metadata: Metadata = {
  title: "Appearance settings | RIFT",
  description: "Configure RIFT themes, colors, typography, and interface contrast.",
};

export default function AppearanceSettingsPage() {
  return (
    <>
      <SettingsPageHeader
        title="Appearance"
        description="App themes, colors, fonts, and contrast"
      />
      <AppearanceSection />
    </>
  );
}
