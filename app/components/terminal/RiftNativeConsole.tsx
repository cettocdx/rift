"use client";
import { useState } from "react";
import { useDesktopWorkspaceAccess } from "@/app/hooks/useDesktopWorkspaceAccess";
import { useNativeConsoleRuntime } from "./useNativeConsoleRuntime";
import { RiftConsoleView } from "./RiftConsoleView";
export function RiftNativeConsole() {
  const access = useDesktopWorkspaceAccess();
  const [selected, setSelected] = useState("");
  const grants = access.grants.filter((g) => g.writable && g.kind !== "file");
  const grant = grants.find((g) => g.grantId === selected) ?? grants[0];
  const runtime = useNativeConsoleRuntime(grant?.grantId ?? null);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2 text-xs">
        <span>Native</span>
        <select
          aria-label="Native workspace"
          value={grant?.grantId ?? ""}
          onChange={(e) => setSelected(e.target.value)}
          className="min-w-0 flex-1 bg-transparent"
        >
          <option value="" disabled>
            Choose a writable folder
          </option>
          {grants.map((g) => (
            <option key={g.grantId} value={g.grantId}>
              {g.rootPath ?? g.name}
            </option>
          ))}
        </select>
        <button
          onClick={() => void access.requestAccess(true)}
          disabled={!!access.busyAction}
        >
          Choose folder
        </button>
        {grant && (
          <button
            title="Stop native work and retain saved history for reconnect"
            onClick={() => void runtime.disconnect()}
          >
            Disconnect
          </button>
        )}
        {(runtime.snapshot.status === "error" ||
          runtime.snapshot.status === "unavailable") &&
          grant && <button onClick={runtime.reconnect}>Reconnect</button>}
      </div>
      {access.error && (
        <p role="alert" className="px-3 text-xs">
          {access.error}
        </p>
      )}
      <div className="min-h-0 flex-1">
        <RiftConsoleView
          key={runtime.ownerRevision}
          snapshot={runtime.snapshot}
          onCommand={runtime.onCommand}
        />
      </div>
    </div>
  );
}
