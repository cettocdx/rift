import type { Metadata } from "next";
import { SettingsPageHeader } from "@/app/components/settings/SettingsShell";
import { KeyboardSection } from "@/app/components/settings/sections/KeyboardSection";

export const metadata: Metadata = {
  title: "Keyboard & notifications settings | RIFT",
  description: "Keyboard shortcut reference and notification scope.",
};

export default function KeyboardSettingsPage() {
  return (
    <>
      <SettingsPageHeader
        title="Keyboard & notifications"
        description="Shortcut reference and notification scope"
      />
      <KeyboardSection />
    </>
  );
}
