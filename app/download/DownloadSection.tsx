"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { useIsStandalone } from "@/hooks/use-is-standalone";
import { downloadLinks } from "./constants";
import {
  AndroidIcon,
  AppleIcon,
  DeviceIcon,
  DownloadIcon,
  LinuxIcon,
  WindowsIcon,
} from "./icons";

export type Platform =
  | "macos"
  | "windows"
  | "linux"
  | "ios"
  | "android"
  | "unknown";

type PlatformNavigator = Pick<
  Navigator,
  "userAgent" | "platform" | "maxTouchPoints"
>;

export interface DetectedPlatform {
  platform: Platform;
  displayName: string;
  downloadUrl: string | null;
}

const DESKTOP_VERSION = "0.1.0";

export function detectPlatform(
  platformNavigator: PlatformNavigator = navigator,
): DetectedPlatform {
  const userAgent = platformNavigator.userAgent.toLowerCase();
  const platform = platformNavigator.platform?.toLowerCase() || "";

  const isIpadOS =
    platformNavigator.platform === "MacIntel" &&
    platformNavigator.maxTouchPoints > 1;

  if (/iphone|ipad|ipod/.test(userAgent) || isIpadOS) {
    return {
      platform: "ios",
      displayName: "iOS",
      downloadUrl: null,
    };
  }

  if (/android/.test(userAgent)) {
    return {
      platform: "android",
      displayName: "Android",
      downloadUrl: null,
    };
  }

  if (
    userAgent.includes("mac") ||
    platform.includes("mac") ||
    userAgent.includes("darwin")
  ) {
    return {
      platform: "macos",
      displayName: "macOS",
      downloadUrl: downloadLinks.macos,
    };
  }

  if (userAgent.includes("win") || platform.includes("win")) {
    return {
      platform: "windows",
      displayName: "Windows",
      downloadUrl: downloadLinks.windows,
    };
  }

  if (
    userAgent.includes("linux") ||
    userAgent.includes("x11") ||
    userAgent.includes("cros") ||
    platform.includes("linux")
  ) {
    return {
      platform: "linux",
      displayName: "Linux",
      downloadUrl: null,
    };
  }

  return {
    platform: "unknown",
    displayName: "your platform",
    downloadUrl: null,
  };
}

export function hasDesktopDownload(
  detected: DetectedPlatform,
): detected is DetectedPlatform & {
  platform: "macos" | "windows";
  downloadUrl: string;
} {
  return (
    (detected.platform === "macos" || detected.platform === "windows") &&
    Boolean(detected.downloadUrl)
  );
}

const serverSnapshot: DetectedPlatform | null = null;
let clientSnapshot: DetectedPlatform | null = null;

function getClientSnapshot(): DetectedPlatform {
  if (!clientSnapshot) {
    clientSnapshot = detectPlatform();
  }
  return clientSnapshot;
}

function getServerSnapshot(): DetectedPlatform | null {
  return serverSnapshot;
}

function subscribe() {
  return () => {};
}

export function useDetectedPlatform(): DetectedPlatform | null {
  return useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot);
}

export function DownloadSection() {
  const detected = useDetectedPlatform();

  if (!detected) {
    return (
      <section
        aria-label="Detecting your platform"
        role="status"
        className="rounded-[16px] border border-border bg-[var(--surface)] p-5 sm:p-6"
      >
        <div className="h-3 w-28 animate-pulse rounded-sm bg-[var(--signal-bright)]/12 motion-reduce:animate-none" />
        <div className="mt-4 h-6 w-48 animate-pulse rounded-sm bg-[var(--signal-bright)]/12 motion-reduce:animate-none" />
        <div className="mt-5 h-11 w-full animate-pulse rounded-[12px] bg-[var(--signal-bright)]/12 motion-reduce:animate-none" />
        <span className="sr-only">Detecting your operating system…</span>
      </section>
    );
  }

  if (detected.platform === "ios" || detected.platform === "android") {
    return <MobileInstallCard detected={detected} />;
  }

  if (!hasDesktopDownload(detected)) {
    return <UnsupportedDesktopCard detected={detected} />;
  }

  const isMacOS = detected.platform === "macos";

  return (
    <section
      aria-labelledby="detected-download-title"
      className="rounded-[16px] border border-border bg-[var(--surface)] p-5 sm:p-6"
    >
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-[10px] border border-border bg-[var(--surface)] text-[var(--cursor-text-secondary)]">
          <PlatformIcon platform={detected.platform} />
        </div>
        <div className="min-w-0">
          <p className="text-[11px] text-[var(--muted-foreground)]">Detected platform</p>
          <h2
            id="detected-download-title"
            className="mt-0.5 text-[18px] font-medium tracking-[-0.025em] text-[var(--foreground)]"
          >
            RIFT for {detected.displayName}
          </h2>
        </div>
      </div>

      <Button
        asChild
        size="lg"
        className="mt-6 h-11 w-full cursor-pointer rounded-[12px] bg-[var(--foreground)] text-[13px] font-semibold text-[var(--background)] shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] transition-[background-color,transform] hover:bg-[var(--foreground)] active:translate-y-px"
      >
        <a
          href={detected.downloadUrl}
          download={isMacOS ? "RIFT-0.1.0-macOS-arm64.dmg" : undefined}
          aria-describedby={isMacOS ? "macos-direct-build-note" : undefined}
        >
          <DownloadIcon className="size-4" />
          Download for {detected.displayName}
        </a>
      </Button>

      <p className="mt-3 text-[11px] leading-4 text-[var(--muted-foreground)]">
        Current build {DESKTOP_VERSION}. Apple Silicon. Direct download from
        RIFT.
      </p>

      {isMacOS ? (
        <div
          id="macos-direct-build-note"
          role="note"
          className="mt-4 rounded-[12px] border border-border bg-[var(--surface)] px-3.5 py-3"
        >
          <p className="text-[12px] font-medium text-[var(--foreground)]">
            Unsigned developer build
          </p>
          <p className="mt-1 text-[11px] leading-[18px] text-[var(--muted-foreground)]">
            This build is not signed with Apple Developer ID or notarized by
            Apple. If macOS blocks the first launch, try opening RIFT once, then
            choose Open Anyway in System Settings, Privacy &amp; Security.
          </p>
        </div>
      ) : null}
    </section>
  );
}

function UnsupportedDesktopCard({ detected }: { detected: DetectedPlatform }) {
  const isLinux = detected.platform === "linux";
  const isDesktopReleasePending =
    detected.platform === "macos" || detected.platform === "windows";

  return (
    <section
      aria-labelledby="unsupported-download-title"
      className="rounded-[16px] border border-border bg-[var(--surface)] p-5 sm:p-6"
    >
      <div className="flex size-10 items-center justify-center rounded-[10px] border border-border bg-[var(--surface)] text-[var(--cursor-text-secondary)]">
        <PlatformIcon platform={detected.platform} />
      </div>
      <h2
        id="unsupported-download-title"
        className="mt-5 text-[18px] font-medium tracking-[-0.025em] text-[var(--foreground)]"
      >
        {isDesktopReleasePending
          ? `Verified ${detected.displayName} build in progress`
          : isLinux
            ? "Use RIFT in your browser on Linux"
            : "Choose a supported desktop installer"}
      </h2>
      <p className="mt-2 max-w-md text-[13px] leading-5 text-[var(--cursor-text-secondary)]">
        {isDesktopReleasePending
          ? "We will publish this installer only after platform signing and release verification pass. RIFT remains fully available in your browser meanwhile."
          : isLinux
            ? "The desktop build is not available for Linux. The browser app remains available without an installer."
            : "We could not identify your operating system. Verified desktop builds will appear below when they are ready."}
      </p>
      <Button
        asChild
        size="lg"
        variant="outline"
        className="mt-5 h-11 cursor-pointer rounded-[12px] border-border bg-[var(--surface)] text-[13px] text-[var(--foreground)] transition-[background-color,transform] hover:bg-[var(--surface)] hover:text-[var(--foreground)] active:translate-y-px"
      >
        <a href={isDesktopReleasePending ? "/" : "#desktop-downloads"}>
          {isDesktopReleasePending
            ? "Open RIFT in browser"
            : "View release status"}
        </a>
      </Button>
    </section>
  );
}

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function MobileInstallCard({ detected }: { detected: DetectedPlatform }) {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const isStandalone = useIsStandalone();

  useEffect(() => {
    if (detected.platform !== "android") return;

    const handleBeforeInstall = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    };

    const handleAppInstalled = () => {
      setDeferredPrompt(null);
      setInstalled(true);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstall);
    window.addEventListener("appinstalled", handleAppInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstall);
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, [detected.platform]);

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;
    try {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === "accepted") {
        setInstalled(true);
      }
    } catch {
      // If the browser blocks a repeated prompt, the manual path stays visible.
    } finally {
      setDeferredPrompt(null);
    }
  };

  if (isStandalone) {
    return (
      <section
        aria-labelledby="installed-app-title"
        className="rounded-[16px] border border-border bg-[var(--surface)] p-5 sm:p-6"
      >
        <div className="flex size-10 items-center justify-center rounded-[10px] border border-border bg-[var(--surface)] text-[var(--cursor-text-secondary)]">
          <MobilePlatformIcon platform={detected.platform} />
        </div>
        <h2
          id="installed-app-title"
          className="mt-5 text-[18px] font-medium tracking-[-0.025em] text-[var(--foreground)]"
        >
          RIFT is already installed
        </h2>
        <p className="mt-2 text-[13px] leading-5 text-[var(--cursor-text-secondary)]">
          Open RIFT from your home screen to continue.
        </p>
      </section>
    );
  }

  return (
    <section
      aria-labelledby="mobile-install-title"
      className="rounded-[16px] border border-border bg-[var(--surface)] p-5 sm:p-6"
    >
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-[10px] border border-border bg-[var(--surface)] text-[var(--cursor-text-secondary)]">
          <MobilePlatformIcon platform={detected.platform} />
        </div>
        <div>
          <p className="text-[11px] text-[var(--muted-foreground)]">Mobile web app</p>
          <h2
            id="mobile-install-title"
            className="mt-0.5 text-[18px] font-medium tracking-[-0.025em] text-[var(--foreground)]"
          >
            Install RIFT on {detected.displayName}
          </h2>
        </div>
      </div>

      {installed ? (
        <div
          role="status"
          className="mt-5 rounded-[12px] border border-border bg-[var(--signal-bright)] px-3 py-2.5 text-[12px] text-[var(--foreground)]"
        >
          Installed. Open RIFT from your home screen.
        </div>
      ) : null}

      {!installed && deferredPrompt ? (
        <Button
          size="lg"
          className="mt-5 h-11 w-full cursor-pointer rounded-[12px] bg-[var(--foreground)] text-[13px] font-semibold text-[var(--background)] shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] transition-[background-color,transform] hover:bg-[var(--foreground)] active:translate-y-px"
          onClick={handleInstallClick}
        >
          <DownloadIcon className="size-4" />
          Install RIFT
        </Button>
      ) : null}

      {!installed ? (
        <div className="mt-6">
          <h3 className="text-[12px] font-medium text-[var(--foreground)]">
            {deferredPrompt ? "Manual install" : "Add RIFT to your home screen"}
          </h3>
          <InstallInstructions platform={detected.platform} />
        </div>
      ) : null}
    </section>
  );
}

type InstallStep = { title: string; detail: string };

function InstallInstructions({ platform }: { platform: Platform }) {
  const steps: InstallStep[] =
    platform === "ios"
      ? [
          {
            title: "Open Share",
            detail:
              "In Safari, open Share. If it is hidden, open the More menu first.",
          },
          {
            title: "Add to Home Screen",
            detail: "Choose Add to Home Screen from the actions list.",
          },
          {
            title: "Confirm",
            detail: "Choose Add in the top-right corner.",
          },
        ]
      : [
          {
            title: "Open the browser menu",
            detail: "Open the menu in the top-right corner.",
          },
          {
            title: "Choose Install app",
            detail: "Some browsers label this Add to Home screen.",
          },
          {
            title: "Confirm",
            detail: "Choose Install to add RIFT to your device.",
          },
        ];

  return <StepsList steps={steps} />;
}

function StepsList({ steps }: { steps: InstallStep[] }) {
  return (
    <ol className="mt-3 space-y-3">
      {steps.map((step, index) => (
        <li key={step.title} className="flex gap-3 text-[12px]">
          <span
            aria-hidden
            className="mt-0.5 font-mono text-[10px] text-[var(--muted-foreground)]"
          >
            {String(index + 1).padStart(2, "0")}
          </span>
          <div>
            <p className="font-medium text-[var(--foreground)]">{step.title}</p>
            <p className="mt-0.5 leading-5 text-[var(--muted-foreground)]">{step.detail}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

function PlatformIcon({ platform }: { platform: Platform }) {
  const className = "size-5";

  switch (platform) {
    case "macos":
      return <AppleIcon className={className} />;
    case "windows":
      return <WindowsIcon className={className} />;
    case "linux":
      return <LinuxIcon className={className} />;
    default:
      return <DeviceIcon className={className} />;
  }
}

function MobilePlatformIcon({ platform }: { platform: Platform }) {
  const className = "size-5";

  switch (platform) {
    case "ios":
      return <AppleIcon className={className} />;
    case "android":
      return <AndroidIcon className={className} />;
    default:
      return <DeviceIcon className={className} />;
  }
}
