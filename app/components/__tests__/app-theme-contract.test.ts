import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const readWorkspaceFile = (path: string) =>
  readFileSync(join(process.cwd(), path), "utf8");

const css = readWorkspaceFile("app/globals.css");
const rootLayout = readWorkspaceFile("app/layout.tsx");
const chatLayout = readWorkspaceFile("app/components/ChatLayout.tsx");
const sidebarHeader = readWorkspaceFile("app/components/SidebarHeader.tsx");
const proChatLayout = readWorkspaceFile("app/components/pro/ProChatLayout.tsx");
const proTitlebar = readWorkspaceFile("app/components/pro/ProTitlebar.tsx");
const proStatusBar = readWorkspaceFile("app/components/pro/ProStatusBar.tsx");
const button = readWorkspaceFile("components/ui/button.tsx");
const markdownTable = readWorkspaceFile("app/components/MarkdownTable.tsx");
const landing = readWorkspaceFile("app/components/landing/LandingPage.tsx");
const hackerMode = readWorkspaceFile("app/components/HackerMode.tsx");

function declarationBlock(marker: string): string {
  const markerIndex = css.indexOf(marker);
  expect(markerIndex).toBeGreaterThanOrEqual(0);
  const openingBrace = css.indexOf("{", markerIndex);
  const closingBrace = css.indexOf("\n}", openingBrace);
  expect(openingBrace).toBeGreaterThan(markerIndex);
  expect(closingBrace).toBeGreaterThan(openingBrace);
  return css.slice(openingBrace + 1, closingBrace);
}

function hexToken(block: string, token: string): string {
  const value = block.match(
    new RegExp(`--${token}:\\s*(#[0-9a-fA-F]{8}|#[0-9a-fA-F]{6})\\b`),
  )?.[1];
  expect(value).toBeDefined();
  return value!;
}

type Rgba = { red: number; green: number; blue: number; alpha: number };

function parseHex(hex: string): Rgba {
  const channels = hex
    .slice(1)
    .match(/.{2}/g)!
    .map((channel) => Number.parseInt(channel, 16));
  return {
    red: channels[0] / 255,
    green: channels[1] / 255,
    blue: channels[2] / 255,
    alpha: (channels[3] ?? 255) / 255,
  };
}

function composite(foreground: Rgba, background: Rgba): Rgba {
  return {
    red:
      foreground.red * foreground.alpha +
      background.red * (1 - foreground.alpha),
    green:
      foreground.green * foreground.alpha +
      background.green * (1 - foreground.alpha),
    blue:
      foreground.blue * foreground.alpha +
      background.blue * (1 - foreground.alpha),
    alpha: 1,
  };
}

function relativeLuminance(color: Rgba): number {
  const channels = [color.red, color.green, color.blue].map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrastRatio(first: string, second: string): number {
  const background = parseHex(second);
  const opaqueBackground =
    background.alpha < 1
      ? composite(background, { red: 0, green: 0, blue: 0, alpha: 1 })
      : background;
  const foreground = composite(parseHex(first), opaqueBackground);
  const luminances = [
    relativeLuminance(foreground),
    relativeLuminance(opaqueBackground),
  ].sort((left, right) => right - left);
  return (luminances[0] + 0.05) / (luminances[1] + 0.05);
}

const workspaceChrome = readFileSync(
  join(process.cwd(), "lib/ui/workspace-chrome.ts"),
  "utf8",
);

describe("authenticated app theme contract", () => {
  const light = declarationBlock("body[data-rift-shell-workspace],");
  const dark = declarationBlock(".dark body[data-rift-shell-workspace],");
  const appearance = declarationBlock(
    'html[data-rift-appearance="ready"] body[data-rift-shell-workspace],',
  );
  const cursorDark = declarationBlock(
    'html.dark[data-rift-appearance="ready"][data-rift-preset="cursor"]',
  );

  it("uses a white light canvas and a high-contrast neutral dark shell", () => {
    expect(hexToken(light, "background")).toBe("#ffffff");
    expect(hexToken(light, "sidebar")).toBe("#f7f7f7");
    // Sampled per plane off the reference DESKTOP app's running window. The
    // content plane is the lighter one and the chrome is the darker one --
    // reading those two in the wrong order is the inversion this shell
    // shipped with -- but both sit two steps below the pair taken from
    // Cursor, and the ink is warm rather than neutral grey.
    expect(hexToken(dark, "background")).toBe("#151515");
    expect(hexToken(dark, "foreground")).toBe("#f5f5f5");
    expect(hexToken(dark, "sidebar")).toBe("#141414");
    expect(hexToken(dark, "primary")).toBe("#969696");
    expect(hexToken(dark, "cursor-text-primary")).toBe("#f5f5f5");
    expect(hexToken(dark, "cursor-text-secondary")).toBe("#a3a29a");
    expect(hexToken(dark, "cursor-icon-secondary")).toBe("#a7a7a7");
    expect(hexToken(dark, "cursor-text-tertiary")).toBe("#898782");
    expect(hexToken(dark, "cursor-text-quaternary")).toBe("#666666");
    expect(hexToken(dark, "muted-foreground")).toBe("#898782");
  });

  it.each([
    ["light foreground", light, "foreground", "background"],
    ["light muted copy", light, "muted-foreground", "background"],
    ["light sidebar copy", light, "sidebar-foreground", "sidebar"],
    ["dark foreground", dark, "foreground", "background"],
    ["dark muted copy", dark, "muted-foreground", "background"],
    ["dark sidebar copy", dark, "sidebar-foreground", "sidebar"],
    ["light primary action", light, "primary-foreground", "primary"],
    ["dark primary action", dark, "primary-foreground", "primary"],
  ])("keeps %s above WCAG AA contrast", (_label, block, ink, surface) => {
    expect(
      contrastRatio(hexToken(block, ink), hexToken(block, surface)),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it("uses the shipped UI and monospace stacks without decorative shell effects", () => {
    // The platform UI font, because that is the reference's own face: Cursor
    // resolves its workbench font to -apple-system on a Mac. Geist and Space
    // Grotesk remain appearance preferences.
    expect(light).toContain(
      '--font-cursor-ui: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    );
    expect(light).toContain("font-family: var(--font-cursor-ui)");
    expect(light).toContain("--cursor-font-size-base: 13px");
    // 400, measured off Cursor's own app: every body string there is weight 400
    // in system-ui. 418 is a variable axis value that renders fractionally
    // heavier than the reference, and on faces without that axis it snaps to
    // 500 — which made some rows read bolder than others for no chosen reason.
    expect(light).toContain("--cursor-font-weight-normal: 400");
    expect(light).toContain("--cursor-font-weight-medium: 500");
    expect(light).toContain("--cursor-font-weight-semibold: 600");
    expect(light).toContain("--font-mono: var(--font-cursor-mono)");
    expect(light).not.toContain(
      "--font-jetbrains-mono: var(--font-cursor-mono)",
    );
    expect(light).not.toContain("backdrop-filter");
    expect(dark).not.toContain("backdrop-filter");
    expect(light).not.toContain("radial-gradient");
    expect(dark).not.toContain("radial-gradient");
  });

  it("uses semantic sidebar/main surfaces without terminal chrome", () => {
    expect(chatLayout).toContain("data-rift-workspace");
    expect(chatLayout).toContain("data-rift-sidebar-panel");
    expect(chatLayout).toContain("data-rift-main-panel");
    expect(chatLayout).toContain("bg-[var(--app-scrim)]");
    expect(chatLayout).not.toContain("terminal-panel");
    expect(chatLayout).not.toContain("terminal-border");
  });

  it("enables native vibrancy only in the macOS desktop wrapper", () => {
    expect(rootLayout).toContain('id="rift-vibrancy-bootstrap"');
    expect(rootLayout).toContain("ua.includes('Macintosh')&&");
    expect(rootLayout).toContain("ua.includes('RIFTWrapperLite')");
    expect(rootLayout).toContain("ua.includes('RIFT-Desktop')");
    expect(rootLayout).toContain("window.__RIFT_DESKTOP_LITE__===true");
    expect(rootLayout).toContain(
      "document.documentElement.classList.add('rift-vibrancy')",
    );
  });

  it("leaves the backdrop-filter prefix to the compiler", () => {
    // Writing -webkit-backdrop-filter beside backdrop-filter makes the CSS
    // pipeline collapse the pair and keep only the prefixed one, which ships a
    // declaration that does nothing in engines without the alias. That is how
    // the glass sidebar became 82% transparency over an unblurred page.
    expect(css).not.toContain("-webkit-backdrop-filter:");
  });

  it("keeps the sidebar's material and declares no blur behind it", () => {
    // Polished metal: a translucent fill, lit edges and a raked specular.
    //
    // It declared a 22px backdrop blur for a long time and never ran one — a
    // hand-written -webkit-backdrop-filter beside the standard property made
    // the pipeline keep only the prefixed one. Turning it on cost a full-height
    // surface repainting every frame and bought nothing: the pane sits beside
    // the content, so its backdrop is a flat ground and blurring it returns
    // the same flat ground. The prefix must never come back, and neither must
    // the blur.
    expect(css).toContain("rift-sidebar-metal");
    expect(css).not.toContain("-webkit-backdrop-filter:");
    expect(css).not.toMatch(/backdrop-filter:\s*blur/);
  });

  it("uses independent native surface tints with opaque accessibility fallbacks", () => {
    const nativeMaterial = css.slice(
      css.indexOf("/* Native macOS sidebar material"),
      css.indexOf('html[data-rift-ui-font="system"]'),
    );

    expect(nativeMaterial).toContain("@media (min-width: 950px)");
    expect(nativeMaterial).toContain(
      "html.rift-vibrancy [data-rift-main-panel]",
    );
    expect(nativeMaterial).toContain(
      "background: var(--pro-main-bg, var(--background)) !important",
    );
    // Opaque unless the viewer asked for translucency. The Tauri window is
    // transparent, so a tint here is the desktop wallpaper showing through the
    // nav, not a material -- and it is the same preference that governs the
    // sidebar material everywhere else, not a second switch.
    expect(nativeMaterial).toMatch(
      /html\.rift-vibrancy \[data-rift-sidebar-panel\]\s*\{\s*background: var\(--pro-sidebar-bg, var\(--sidebar\)\) !important/,
    );
    expect(nativeMaterial).toMatch(
      /html\.rift-vibrancy\[data-rift-sidebar="translucent"\]\s+\[data-rift-sidebar-panel\]/,
    );
    expect(nativeMaterial).toContain(
      "var(--rift-appearance-sidebar, var(--sidebar)) 42%",
    );
    expect(nativeMaterial).toContain(
      'html.dark.rift-vibrancy[data-rift-sidebar="translucent"]',
    );
    expect(nativeMaterial).toContain(
      "var(--rift-appearance-sidebar, var(--sidebar)) 36%",
    );
    expect(nativeMaterial).toContain(
      "var(--rift-appearance-background, var(--background)) 72%",
    );
    expect(nativeMaterial).toContain("background: transparent !important");
    expect(nativeMaterial).toContain("backdrop-filter: none !important");
    expect(nativeMaterial).not.toContain("blur(");
    expect(nativeMaterial).toContain("prefers-reduced-transparency: reduce");
  });

  it("derives readable theme roles from the selected palette and scopes dark chrome", () => {
    expect(appearance).toContain(
      "--cursor-text-primary: var(--rift-appearance-foreground)",
    );
    expect(appearance).toContain("--cursor-text-secondary: color-mix(");
    expect(appearance).toContain("--cursor-text-tertiary: color-mix(");
    expect(appearance).toContain(
      "--muted-foreground: var(--cursor-text-secondary)",
    );
    expect(cursorDark).toContain("var(--rift-appearance-foreground) 74%");
    expect(cursorDark).toContain("var(--rift-appearance-foreground) 60%");
    expect(cursorDark).toContain("var(--rift-appearance-foreground) 56%");
    expect(cursorDark).toContain(
      "--pro-titlebar-bg: var(--rift-appearance-background)",
    );
    expect(cursorDark).toContain(
      "--pro-terminal-bg: var(--rift-appearance-background)",
    );
  });

  it("uses semantic actions and table surfaces in both color modes", () => {
    expect(button).toContain(
      '"bg-primary text-primary-foreground shadow-xs hover:opacity-90"',
    );
    expect(button).not.toContain(
      '"bg-primary-foreground text-primary shadow-xs hover:opacity-90"',
    );
    // The aicss data-table frame: a tinted mat carrying the toolbar, with
    // the table inset on its own lighter card. Both layers stay on semantic
    // tokens so the two color modes derive, not fork.
    expect(markdownTable).toContain("border border-border bg-surface-2");
    expect(markdownTable).toContain(
      "rounded-md border border-border/70 bg-background",
    );
    expect(markdownTable).toContain("hover:bg-foreground/[0.06]");
    expect(markdownTable).not.toContain("bg-[#181818]");
    expect(markdownTable).not.toContain("hover:bg-white/[0.06]");
  });

  it("keeps ProShell theme-aware and free of component-level color literals", () => {
    const proShellCss = css.slice(css.indexOf("/* ─── RIFT Pro Lab"));
    const shellComponents = [
      sidebarHeader,
      chatLayout,
      proChatLayout,
      proTitlebar,
      proStatusBar,
    ].join("\n");

    expect(css).toContain("body[data-rift-shell-pro]");
    expect(css).toContain(".dark body[data-rift-shell-pro]");
    expect(proShellCss).toContain("background: var(--pro-shell-canvas)");
    expect(proShellCss).toContain("background: var(--pro-sidebar-bg)");
    expect(proShellCss).not.toMatch(/#[\da-fA-F]{3,8}\b/);
    expect(proShellCss).not.toMatch(/\brgba?\(/);
    expect(shellComponents).not.toMatch(
      /(?:bg|border|text|ring|shadow)-(?:black|white|gray|slate|zinc|neutral|stone|green|emerald|lime|sky|indigo)(?:\b|\/|\[)/,
    );
  });

  it("removes the redundant Pro titlebar and marks both sidebar widths", () => {
    expect(proChatLayout).not.toContain("ProTitlebar");
    expect(proChatLayout).toContain("data-rift-main-panel");
    expect(proChatLayout).toContain("data-rift-sidebar-panel");
  });

  it("uses the shared compact brand lockup only in the visible Pro status chrome", () => {
    expect(proStatusBar).toContain(
      'import { RiftBrandLockup } from "@/components/icons/rift-brand-lockup"',
    );
    expect(proStatusBar).toContain("<RiftBrandLockup");
    expect(proStatusBar).not.toMatch(/<span[^>]*>RIFT<\/span>/);
    expect(proTitlebar).not.toContain("RiftBrandLockup");
  });

  it("loads the terminal preview stylesheet only for the explicit hack-terminal skin", () => {
    expect(rootLayout).toContain('requestedUiSkin === "hack-terminal"');
    expect(rootLayout).toContain('requestedUiSkin === "cursor"');
    expect(rootLayout).toContain('uiSkin === "hack-terminal"');
    expect(rootLayout).toContain('href="/workbench-preview.css"');
    expect(rootLayout).not.toContain(
      'process.env.RIFT_UI_SKIN === "standard" ? undefined : "hack-terminal"',
    );
  });

  it("keeps the Cursor-density sidebar hierarchy and typography", () => {
    expect(sidebarHeader).not.toContain("rift-hack-nav");
    expect(sidebarHeader).toContain("Hack Workbench");
    // CLI Workspace was removed from the sidebar: the route still exists but
    // is no longer one of the surfaces the header advertises.
    expect(sidebarHeader).not.toContain("CLI Workspace");
    expect(sidebarHeader).toContain("Studio");
    // The collapsed icon rail is gone: the desktop sidebar unmounts when it
    // closes, so its "collapsed" state was never reachable.
    expect(sidebarHeader).not.toContain("collapsedNavClass");
    expect(
      existsSync(join(process.cwd(), "app/components/SidebarRail.tsx")),
    ).toBe(false);
    expect(workspaceChrome).toContain(
      "gap-2 rounded-[6px] px-1.5 text-[13px] font-[418] leading-[18px]",
    );
    expect(workspaceChrome).toContain("flex h-[30px] w-full");
    expect(workspaceChrome).toContain("[&>svg]:size-4 [&>svg]:shrink-0");
    // The header no longer carries its own copy of the row class.
    expect(sidebarHeader).not.toMatch(/h-9 w-full items-center gap-2 rounded/);
    expect(chatLayout).toContain("w-[279px]");
    expect(chatLayout).toContain("useResizableAppSidebar");
    expect(proChatLayout).toContain("useResizableAppSidebar");
    expect(chatLayout).toContain(
      '"--sidebar-width": `${sidebarResize.width}px`',
    );
    expect(proChatLayout).toContain(
      '"--sidebar-width": `${sidebarResize.width}px`',
    );
  });

  it("leaves marketing and HackerMode on their isolated palettes", () => {
    expect(landing).toContain("const LANDING_THEME");
    expect(landing).toContain('["--background" as string]: "#070a10"');
    expect(landing).toContain('["--signal" as string]: "#3159e8"');
    expect(hackerMode).toContain(".fui{--bg:");
    expect(hackerMode).toContain("REFERENCE_OVERRIDES");
  });
});
