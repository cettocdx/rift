"use client";

import { RemoteControlTab } from "@/app/components/RemoteControlTab";
import { SettingsSurfaceLink } from "@/app/components/SettingsSurfaceLink";

export function WorkbenchSection() {
  return (
    <div className="space-y-6">
      <section aria-labelledby="workbench-settings-surface">
        <h2
          id="workbench-settings-surface"
          className="mb-3 text-ui font-medium"
        >
          Workbench configuration
        </h2>
        <SettingsSurfaceLink
          title="CLI workspace"
          description="Editor, terminal, source control, files, and execution-target controls live in the workspace where their state is visible."
          href="/workspace"
          actionLabel="Open workspace"
        />
      </section>
      <section aria-label="Build access">
        <RemoteControlTab />
      </section>
    </div>
  );
}
