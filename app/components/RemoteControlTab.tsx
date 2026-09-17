"use client";

import { DesktopConnectionSettings } from "@/app/components/DesktopConnectionSettings";
import { LocalRunnerSettingsCard } from "@/app/components/LocalRunnerSettingsCard";
import { useGlobalState } from "@/app/contexts/GlobalState";
import { BuildAccessSettings } from "@/app/components/BuildAccessSettings";
import { useDesktopWorkspaceAccess } from "@/app/hooks/useDesktopWorkspaceAccess";

const RemoteControlTab = () => {
  const { sandboxPreference } = useGlobalState();
  const {
    busyAction,
    desktopState,
    error,
    grants,
    requestAccess,
    revokeAccess,
  } = useDesktopWorkspaceAccess();

  return (
    <div className="space-y-5">
      <DesktopConnectionSettings />
      <LocalRunnerSettingsCard />
      <BuildAccessSettings
        localExecutionSelected={sandboxPreference !== "e2b"}
        busyAction={busyAction}
        desktopState={desktopState}
        error={error}
        grants={grants}
        onRequestAccess={(writable) => void requestAccess(writable)}
        onRevokeAccess={(grantId) => void revokeAccess(grantId)}
      />
    </div>
  );
};

export { RemoteControlTab };
