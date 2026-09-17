import type { Metadata } from "next";
import { SettingsPageHeader } from "@/app/components/settings/SettingsShell";
import { GeneralSection } from "@/app/components/settings/sections/GeneralSection";

export const metadata: Metadata = {
  title: "General settings | RIFT",
  description: "Personal instructions, custom instructions, and saved notes.",
};

export default function GeneralSettingsPage() {
  return (
    <>
      <SettingsPageHeader
        title="General"
        description="Personal instructions and notes"
      />
      <GeneralSection />
    </>
  );
}
