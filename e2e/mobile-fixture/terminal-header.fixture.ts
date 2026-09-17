import { expect, test } from "@playwright/test";
const buildFixture = require("./terminal-header-build.cjs");
let fixture: { js: string; css: string };
test.beforeAll(async () => {
  fixture = await buildFixture();
});
for (const theme of ["light", "dark"])
  test(`compact terminal header ${theme}`, async ({ page }, info) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/*", (route) =>
      route.request().url() === "http://rift-fixture.test/"
        ? route.fulfill({
            contentType: "text/html",
            body: '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div></body></html>',
          })
        : route.abort(),
    );
    await page.goto("http://rift-fixture.test/");
    await page.evaluate((theme) => {
      document.documentElement.className = theme;
      (window as any).fixtureWidth = 422;
    }, theme);
    await page.addStyleTag({
      content: fixture.css + "html,body{margin:0;font-family:system-ui}",
    });
    await page.addScriptTag({ content: fixture.js });
    const consoleTab = page.getByRole("tab", {
      name: "RIFT console",
      exact: true,
    });
    const shellTab = page.getByRole("tab", { name: "Terminal", exact: true });
    await shellTab.click();
    await expect(page.locator("[data-fixture-terminal]")).toHaveCount(1);
    const newTerminal = page.getByRole("button", {
      name: "New terminal",
      exact: true,
    });
    for (let i = 0; i < 5; i++) await newTerminal.click();
    await expect(
      page.getByRole("tablist", { name: "Terminal sessions" }).getByRole("tab"),
    ).toHaveCount(6);
    await expect(newTerminal).toBeDisabled();
    const geometry = [];
    for (const width of [422, 390, 360, 320]) {
      await page
        .locator("main")
        .evaluate((el, width) => (el.style.width = `${width}px`), width);
      const selected = page
        .getByRole("tablist", { name: "Terminal sessions" })
        .getByRole("tab", { selected: true });
      await selected.press("Home");
      await expect(
        page.getByRole("tab", { name: "Terminal 1", exact: true }),
      ).toBeFocused();
      await page
        .getByRole("tab", { name: "Terminal 1", exact: true })
        .press("End");
      await expect(
        page.getByRole("tab", { name: "Terminal 6", exact: true }),
      ).toBeFocused();
      const measured = await page.locator("main").evaluate((el) => {
        const main = el.getBoundingClientRect();
        const nodes = [
          ...el.querySelectorAll("header button,[role=toolbar] button"),
        ];
        return {
          width: main.width,
          scrollWidth: el.scrollWidth,
          buttons: nodes.map((n) => {
            const r = n.getBoundingClientRect();
            const range = document.createRange();
            range.selectNodeContents(n);
            return {
              label: n.getAttribute("aria-label") || n.textContent,
              w: r.width,
              h: r.height,
              left: r.left,
              right: r.right,
              textHeight: range.getBoundingClientRect().height,
            };
          }),
        };
      });
      expect(measured.scrollWidth).toBeLessThanOrEqual(width);
      for (const button of measured.buttons) {
        expect(button.left).toBeGreaterThanOrEqual(0);
        expect(button.right).toBeLessThanOrEqual(width);
        if (info.project.use.hasTouch) {
          expect(button.w).toBeGreaterThanOrEqual(44);
          expect(button.h).toBeGreaterThanOrEqual(44);
        }
      }
      const tabBounds = await consoleTab.boundingBox();
      expect(
        measured.buttons.find((b) => b.label === "RIFT console")!.textHeight,
      ).toBeLessThan(25);
      expect(tabBounds!.height).toBeLessThanOrEqual(44);
      geometry.push(measured);
    }
    const menu = page.getByRole("button", { name: "Terminal actions" });
    await menu.focus();
    await menu.press("Enter");
    await expect(
      page.getByRole("menuitem", { name: "Split terminal right" }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(menu).toBeFocused();
    await menu.click();
    await page.getByRole("menuitem", { name: "Close active terminal" }).click();
    await expect(
      page.getByRole("tablist", { name: "Terminal sessions" }).getByRole("tab"),
    ).toHaveCount(5);
    await menu.click();
    await page.getByRole("menuitem", { name: "Split terminal right" }).click();
    await expect(
      page.getByRole("tablist", { name: "Terminal sessions" }).getByRole("tab"),
    ).toHaveCount(6);
    const sessionStrip = page.getByRole("tablist", {
      name: "Terminal sessions",
    });
    await expect
      .poll(async () => {
        const viewport = await sessionStrip.boundingBox();
        const selected = await sessionStrip
          .getByRole("tab", { selected: true })
          .boundingBox();
        return (
          !!viewport &&
          !!selected &&
          selected.x >= viewport.x - 1 &&
          selected.x + selected.width <= viewport.x + viewport.width + 1
        );
      })
      .toBe(true);
    const before = await page.evaluate(() => (window as any).fixtureStats);
    await consoleTab.click();
    await page
      .getByRole("button", { name: "Open full-screen terminal" })
      .click();
    await expect(
      page.getByRole("button", { name: "Exit full-screen terminal" }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(consoleTab).toHaveAttribute("aria-selected", "true");
    await shellTab.click();
    expect(await page.evaluate(() => (window as any).fixtureStats)).toEqual(
      before,
    );
    expect(errors).toEqual([]);
    await info.attach("geometry", {
      body: JSON.stringify(geometry, null, 2),
      contentType: "application/json",
    });
    await page.mouse.move(700, 700);
    await page.screenshot({ path: info.outputPath("header.png") });
  });
