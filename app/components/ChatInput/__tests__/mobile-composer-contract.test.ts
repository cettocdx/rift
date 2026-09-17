import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = (path: string) =>
  readFileSync(join(process.cwd(), path), "utf8");

describe("mobile composer contract", () => {
  it("lets the visual viewport resize around the software keyboard", () => {
    const rootLayout = source("app/layout.tsx");
    const palette = source("app/components/ChatInput/ComposerPalette.tsx");

    expect(rootLayout).toContain('interactiveWidget: "resizes-content"');
    expect(rootLayout).not.toMatch(/<meta\s+name=["']viewport["']/);
    expect(palette).toContain("window.visualViewport");
    expect(palette).toContain(
      'window.visualViewport?.addEventListener("resize", scheduleLayout)',
    );
    expect(palette).toContain(
      'window.visualViewport?.addEventListener("scroll", scheduleLayout)',
    );
  });

  it("reserves the home-indicator safe area below follow-up composers", () => {
    expect(source("app/components/ChatInput/ChatInput.tsx")).toContain(
      "pb-[max(12px,env(safe-area-inset-bottom))]",
    );
  });

  it.each([
    "app/components/AttachmentButton.tsx",
    "app/components/ChatInput/BuildModelSelector.tsx",
    "app/components/ChatInput/ChatModeSelector.tsx",
    "app/components/ChatInput/ImageModelSelector.tsx",
    "app/components/ChatInput/ReasoningEffortSelector.tsx",
    "app/components/ChatInput/SubmitStopButton.tsx",
  ])("uses 44px mobile targets and compact desktop targets in %s", (path) => {
    const component = source(path);
    expect(component).toContain("h-11");
    expect(component).toContain("md:h-7");
  });

  it("keeps the mobile header independent from the removed desktop titlebar", () => {
    const shell = source("app/components/pro/ProChatLayout.tsx");

    expect(shell).toContain("data-pro-mobile-app-bar");
    expect(shell).toContain("h-[52px]");
    expect(shell).toContain("size-11");
    expect(shell).not.toContain("<ProTitlebar");
  });
});
