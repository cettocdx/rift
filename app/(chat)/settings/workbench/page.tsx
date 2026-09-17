import type { Metadata } from "next";
import { SettingsPageHeader } from "@/app/components/settings/SettingsShell";
import { WorkbenchSection } from "@/app/components/settings/sections/WorkbenchSection";

export const metadata: Metadata = {
  title: "Workbench & terminal settings | RIFT",
  description: "Workspace, terminal, and Build execution access.",
};

export default function WorkbenchSettingsPage() {
  return (
    <>
      <SettingsPageHeader
        title="Workbench & terminal"
        description="Editor, terminal, and Build access"
      />
      <WorkbenchSection />
    </>
  );
}
