/**
 * The web and desktop window strips retain their platform-specific controls.
 * Both More menus omit Search at desktop widths; the mobile drawer keeps it
 * because the strip is hidden there. Rendered menu behavior is covered in
 * SidebarPremiumNavigation.test.tsx.
 */

import fs from "fs";
import path from "path";

const layoutSrc = fs.readFileSync(
  path.resolve(__dirname, "../pro/ProChatLayout.tsx"),
  "utf8",
);

const registrySrc = fs.readFileSync(
  path.resolve(__dirname, "../../../lib/shortcuts/registry.ts"),
  "utf8",
);

describe("window strip — web and desktop diverge on purpose", () => {
  test("the product mark is web-only", () => {
    expect(layoutSrc).toMatch(/\{isDesktopShell \? null : \(\s*<RiftPixelMark/);
  });

  test("Search appears at opposite times in the two shells", () => {
    // Desktop: only once the rail is gone. Web: only while it is there.
    expect(layoutSrc).toMatch(
      /\(isDesktopShell \? !chatSidebarOpen : chatSidebarOpen\)/,
    );
  });

  test("collapsing the desktop rail promotes New chat into the strip", () => {
    const newChatIdx = layoutSrc.indexOf('data-testid="strip-new-chat"');
    expect(newChatIdx).toBeGreaterThan(-1);
    expect(layoutSrc).toMatch(/isDesktopShell && !chatSidebarOpen/);
  });

  test("the strip decides from a mount-safe flag, not a render-time window read", () => {
    // detectTauri() during render answers false on the server and true in the
    // desktop client; React resolves that mismatch by throwing away the client
    // render, which is precisely the chrome the user is looking at.
    expect(layoutSrc).toMatch(/useIsDesktopShell\(\)/);
    expect(layoutSrc).not.toMatch(/isTauriEnvironment\(\)/);
  });
});

describe("shortcuts match the reference", () => {
  test("the rail toggle is the same chord the reference prints in its tooltip", () => {
    // Read off Cursor.app's own tooltip: "Hide Sidebar ⌘B".
    expect(registrySrc).toMatch(
      /id: "toggle-sidebar"[\s\S]*?binding: \{ mod: true, key: "b" \}/,
    );
  });

  test("search is ⌘K, as the reference labels its own control", () => {
    expect(registrySrc).toMatch(
      /id: "command-palette-k"[\s\S]*?binding: \{ mod: true, key: "k" \}/,
    );
    expect(layoutSrc).toMatch(/title="Search \(⌘K\)"/);
  });
});
