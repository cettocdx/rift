import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { DownloadPageContent } from "../DownloadPageContent";
import {
  detectPlatform,
  DownloadSection,
  hasDesktopDownload,
} from "../DownloadSection";

jest.mock("convex/react", () => ({
  Authenticated: ({ children }: { children: ReactNode }) => children,
  Unauthenticated: () => null,
}));

jest.mock("@/app/components/landing/LandingHeader", () => ({
  LandingHeader: () => <header>Landing navigation</header>,
}));

function platformNavigator(
  userAgent: string,
  platform: string,
  maxTouchPoints = 0,
) {
  return { userAgent, platform, maxTouchPoints } as Navigator;
}

describe("download platform handling", () => {
  it("detects Linux as unsupported without assigning a macOS installer", () => {
    const detected = detectPlatform(
      platformNavigator(
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36",
        "Linux x86_64",
      ),
    );

    expect(detected).toEqual({
      platform: "linux",
      displayName: "Linux",
      downloadUrl: null,
    });
    expect(hasDesktopDownload(detected)).toBe(false);
  });

  it("leaves unknown platforms unsupported", () => {
    const detected = detectPlatform(
      platformNavigator("ExampleBrowser/1.0", "Plan9"),
    );

    expect(detected).toEqual({
      platform: "unknown",
      displayName: "your platform",
      downloadUrl: null,
    });
    expect(hasDesktopDownload(detected)).toBe(false);
  });

  it("offers the current macOS direct build while withholding Windows", () => {
    const mac = detectPlatform(
      platformNavigator("Mozilla/5.0 (Macintosh; Intel Mac OS X)", "MacIntel"),
    );
    const windows = detectPlatform(
      platformNavigator("Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "Win32"),
    );

    expect(hasDesktopDownload(mac)).toBe(true);
    expect(mac.downloadUrl).toBe("/downloads/RIFT-mac.dmg");
    expect(hasDesktopDownload(windows)).toBe(false);
    expect(windows.downloadUrl).toBeNull();
  });

  it("never renders a DMG action for an unsupported OS", () => {
    Object.defineProperty(window.navigator, "userAgent", {
      configurable: true,
      value: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36",
    });
    Object.defineProperty(window.navigator, "platform", {
      configurable: true,
      value: "Linux x86_64",
    });

    const { container } = render(<DownloadSection />);

    expect(
      screen.getByRole("link", { name: "View release status" }),
    ).toHaveAttribute("href", "#desktop-downloads");
    expect(container.querySelector('a[href$=".dmg"]')).toBeNull();
  });

  it("puts every download option before the dedicated 4K world visual", () => {
    render(<DownloadPageContent />);

    expect(
      screen.getByRole("heading", {
        name: "RIFT on your machine.",
      }),
    ).toBeInTheDocument();

    const downloadHeading = screen.getByRole("heading", {
      name: "Download now",
    });
    const macRelease = screen.getByRole("link", {
      name: /Download RIFT for macOS, Apple Silicon, DMG/,
    });
    const windowsRelease = screen.getByLabelText(
      /RIFT for Windows, Windows 64-bit, EXE: Signed current build pending/,
    );
    expect(macRelease).toHaveAttribute("href", "/downloads/RIFT-mac.dmg");
    expect(macRelease).toHaveAttribute(
      "download",
      "RIFT-0.1.0-macOS-arm64.dmg",
    );
    expect(macRelease).toHaveAccessibleDescription(
      /Unsigned direct build. Apple verification pending./,
    );
    expect(windowsRelease).toHaveAttribute("aria-disabled", "true");
    expect(
      screen.getByRole("link", {
        name: /Download RIFT for macOS/,
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", {
        name: /Download RIFT for Windows/,
      }),
    ).not.toBeInTheDocument();
    const worldVisual = screen.getByAltText(
      /Earth at night seen from orbit beneath a space station/,
    );

    expect(
      downloadHeading.compareDocumentPosition(worldVisual) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
    expect(worldVisual).toHaveAttribute("loading", "lazy");
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    // One main landmark, owned by the shared marketing shell rather than by
    // this page; the skip link targets its body.
    expect(screen.getAllByRole("main")).toHaveLength(1);
    expect(
      screen.getByText(/macOS direct build available/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Unsigned direct build. Apple verification pending./),
    ).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/[—–]/);
  });
});
