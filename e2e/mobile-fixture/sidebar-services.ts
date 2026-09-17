// Offline routing adapter, not Next App Router or a native WKWebView host.
// This isolates actual sidebar rendering when pathname subscriptions update.
// Passing it does not rule out native event-loop/compositor or router failures.
import { useSyncExternalStore } from "react";
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export const usePathname = () =>
  useSyncExternalStore(subscribe, () => location.pathname);
const navigate = (path: string) => {
  history.pushState({}, "", path);
  for (const listener of listeners) listener();
};
const router = { push: navigate, replace: navigate, prefetch: () => {} };
export const useRouter = () => router;
export const useSearchParams = () => new URLSearchParams(location.search);
const noop = () => {};
const state = {
  closeSidebar: noop,
  setChatSidebarOpen: noop,
  initializeChat: noop,
  initializeNewChat: noop,
  chatPurpose: "app",
  setBuildPreviewOpen: noop,
  setBuildPreviewUrl: noop,
};
export const useGlobalState = () => state;
