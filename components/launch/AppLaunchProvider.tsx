"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import Loading from "@/components/ui/loading";
import { AppLaunchScreen } from "./AppLaunchScreen";

const LaunchContext = createContext({ complete: false, finish: () => {} });

/** Root-owned latch: reconnects and route changes must not replay startup. */
export function AppLaunchProvider({ children }: { children: ReactNode }) {
  const [complete, setComplete] = useState(false);
  const pathname = usePathname();
  const [initialPath] = useState(pathname);
  const navigated = pathname !== initialPath;
  const finish = useCallback(() => setComplete(true), []);
  // Record navigation before children render, so a route fallback cannot flash.
  if (navigated && !complete) setComplete(true);
  const value = useMemo(
    () => ({ complete: complete || navigated, finish }),
    [complete, navigated, finish],
  );
  return (
    <LaunchContext.Provider value={value}>{children}</LaunchContext.Provider>
  );
}

/** Mount with the real surface, not its dynamic-import placeholder. */
export function AppLaunchComplete() {
  const { finish } = useContext(LaunchContext);
  useEffect(finish, [finish]);
  return null;
}

export function AppLaunchFallback() {
  const { complete } = useContext(LaunchContext);
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    if (complete) return;
    const timeout = window.setTimeout(() => setSlow(true), 20000);
    return () => window.clearTimeout(timeout);
  }, [complete]);

  if (complete) return <Loading />;
  return (
    <Dialog.Root open>
      <Dialog.Content
        className="rift-launch-modal"
        aria-describedby={undefined}
        onEscapeKeyDown={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <Dialog.Title className="sr-only">Opening RIFT</Dialog.Title>
        <AppLaunchScreen
          status={slow ? "Taking longer than expected" : "Opening RIFT"}
          error={
            slow
              ? "Check your connection, or try opening RIFT again."
              : undefined
          }
          onRetry={() => window.location.reload()}
        />
      </Dialog.Content>
    </Dialog.Root>
  );
}
