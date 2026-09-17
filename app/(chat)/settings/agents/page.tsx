import type { Metadata } from "next";
import { SettingsPageHeader } from "@/app/components/settings/SettingsShell";
import { AgentsSection } from "@/app/components/settings/sections/AgentsSection";

export const metadata: Metadata = {
  title: "Agents & permissions settings | RIFT",
  description: "Agent roster, execution environment, queues, and security guardrails.",
};

export default function AgentsSettingsPage() {
  return (
    <>
      <SettingsPageHeader
        title="Agents & permissions"
        description="Crew, execution, queues, and guardrails"
      />
      <AgentsSection />
    </>
  );
}
