import type { Metadata } from "next";
import { ProtectedPageBoundary } from "@/app/components/page-shell/ProtectedPageBoundary";
import { SettingsShell } from "@/app/components/settings/SettingsShell";

export const metadata: Metadata = {
  title: "Settings | RIFT",
  description: "Configure your RIFT workspace, agents, data, and account.",
};

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ProtectedPageBoundary resource="settings">
      <SettingsShell>{children}</SettingsShell>
    </ProtectedPageBoundary>
  );
}
