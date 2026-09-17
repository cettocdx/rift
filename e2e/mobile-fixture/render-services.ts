// Offline only: real dock reducer/hook, inert application service boundaries.
import { useGlobalState as useSidebarState } from "./sidebar-services";
const noop = () => {};
const disabled = () => {
  throw new Error("Application services disabled in render fixture");
};
const extra = {
  selectedModel: "build-codex",
  subscription: "pro",
  hasPaidContext: true,
  chatMode: "plan",
  sidebarOpen: false,
  sidebarContent: null,
  buildPreviewOpen: false,
  buildPreviewUrl: null,
  terminalDockOpen: false,
  setSidebarOpen: noop,
  setSidebarContent: noop,
  setTerminalDockOpen: noop,
  queueMessage: disabled,
};
export const useGlobalState = () => ({ ...useSidebarState(), ...extra });
