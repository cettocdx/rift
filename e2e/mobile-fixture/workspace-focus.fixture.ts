import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import tailwindcss from "@tailwindcss/postcss";

// PostCSS belongs to the installed Tailwind adapter; resolve its dependency
// there rather than relying on a package-manager hoist into the app root.
const requireRoot = createRequire(
  path.resolve(__dirname, "../../package.json"),
);
const postcss = createRequire(requireRoot.resolve("@tailwindcss/postcss"))(
  "postcss",
);

// Use both real stylesheet sources in app/layout.tsx order. A component-only
// fixture misses workspace.css's unlayered portal focus rule.
let styles: string;
test.beforeAll(async () => {
  const from = path.resolve(__dirname, "../../app/globals.css");
  const globals = await postcss([tailwindcss()]).process(
    readFileSync(from, "utf8"),
    { from },
  );
  styles =
    globals.css +
    "\n" +
    readFileSync(
      path.resolve(__dirname, "../../app/styles/workspace.css"),
      "utf8",
    );
});

test("portalled command search respects explicit focus while other controls stay visible", async ({
  page,
}) => {
  await page.setContent(`<style>${styles}</style>
    <main class="pro-shell"><button id="shell">Shell action</button></main>
    <div data-slot="popover-content">
      <input id="search" cmdk-input="" class="outline-none focus-visible:outline-none" aria-label="Search tabs" />
      <input id="ordinary" aria-label="Ordinary input" />
      <input id="default-command" cmdk-input="" class="outline-none" aria-label="Default command" />
      <button id="action">Action</button>
    </div>`);
  await page.keyboard.press("Tab");
  await page.locator("#shell").focus();
  await expect(page.locator("#shell")).toBeFocused();
  await expect(page.locator("#shell")).toHaveCSS("outline-style", "solid");
  await page.locator("#search").focus();
  await expect(page.locator("#search")).toBeFocused();
  await expect(page.locator("#search")).toHaveCSS("outline-style", "none");
  for (const id of ["ordinary", "default-command", "action"]) {
    await page.locator(`#${id}`).focus();
    await expect(page.locator(`#${id}`)).toBeFocused();
    await expect(page.locator(`#${id}`)).toHaveCSS("outline-style", "solid");
    await expect(page.locator(`#${id}`)).toHaveCSS("outline-width", "1px");
  }
});
