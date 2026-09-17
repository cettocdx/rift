"use client";
import { useSyncExternalStore } from "react";
import { isTauriEnvironment } from "@/app/hooks/useTauri";
import { useRiftConsoleRuntime } from "./useRiftConsoleRuntime";
import { RiftConsoleView } from "./RiftConsoleView";
import { RiftNativeConsole } from "./RiftNativeConsole";
function CloudConsole() {
  const runtime = useRiftConsoleRuntime();
  return <RiftConsoleView {...runtime} />;
}
const subscribeDesktop = () => () => {};
const serverDesktop = () => null;
export function RiftAgentConsole() {
  const desktop = useSyncExternalStore<boolean | null>(
    subscribeDesktop,
    isTauriEnvironment,
    serverDesktop,
  );
  if (process.env.NEXT_PUBLIC_RIFT_NATIVE_CONSOLE === "true") {
    if (desktop === null) return null;
    if (desktop) return <RiftNativeConsole />;
  }
  return <CloudConsole />;
}
