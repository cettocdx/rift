import { createContext, useContext, useState, type ReactNode } from "react";
import type { SidebarContent } from "../../types/chat";
import { useGlobalState as useShellState } from "./chat-shell-state";

export function rejectTranscriptService(operation: string): never {
  const host = window as unknown as { __transcriptServiceAttempts?: string[] };
  (host.__transcriptServiceAttempts ??= []).push(operation);
  throw new Error(`Fixture service disabled: ${operation}`);
}
function useDockState() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarContent, setSidebarContent] = useState<SidebarContent | null>(
    null,
  );
  const [buildPreviewOpen, setBuildPreviewOpen] = useState(false);
  const [terminalDockOpen, setTerminalDockOpen] = useState(false);
  return {
    sidebarOpen,
    setSidebarOpen,
    sidebarContent,
    setSidebarContent,
    buildPreviewOpen,
    setBuildPreviewOpen,
    terminalDockOpen,
    setTerminalDockOpen,
    buildPreviewUrl: new URLSearchParams(location.search).has("modulePreview")
      ? "https://preview.rift.test/app"
      : new URLSearchParams(location.search).has("realPreview")
        ? `${location.origin}/preview-fixture`
        : null,
    queueMessage: () => rejectTranscriptService("queueMessage"),
  };
}
const DockState = createContext<ReturnType<typeof useDockState> | null>(null);
export function TranscriptDockState({ children }: { children: ReactNode }) {
  return <DockState value={useDockState()}>{children}</DockState>;
}
export function useGlobalState() {
  const shell = useShellState();
  const dock = useContext(DockState);
  if (!dock) throw Error("Transcript dock fixture provider missing");
  return { ...shell, ...dock };
}
