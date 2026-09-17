import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
const css = readFileSync(
  path.resolve(__dirname, "../../app/globals.css"),
  "utf8",
);
const native = css.slice(
  css.indexOf("/* Native macOS sidebar material"),
  css.indexOf('html[data-rift-ui-font="system"]'),
);
for (const dark of [false, true]) {
  test(`${dark ? "dark" : "light"} native surfaces have separate tint weights`, async ({
    page,
  }) => {
    await page.setContent(
      `<style>:root{--rift-appearance-sidebar:#202020;--rift-appearance-background:#181818;--sidebar:#202020;--background:#181818} ${native}</style><div data-rift-route-shell="chat"><aside data-rift-sidebar-panel>Navigation</aside><main data-rift-main-panel>Conversation</main></div>`,
    );
    await page.evaluate((dark) => {
      document.documentElement.className = `rift-vibrancy ${dark ? "dark" : ""}`;
      document.documentElement.dataset.riftSidebar = "translucent";
    }, dark);
    const colors = () =>
      page.evaluate(() =>
        ["[data-rift-sidebar-panel]", "[data-rift-main-panel]"].map(
          (selector) =>
            getComputedStyle(document.querySelector(selector)!).backgroundColor,
        ),
      );
    const values = await colors();
    expect(
      await page.evaluate(
        () => getComputedStyle(document.body).backgroundColor,
      ),
    ).toBe("rgba(0, 0, 0, 0)");
    const base = await page.evaluate(
      () =>
        getComputedStyle(
          document.querySelector('[data-rift-route-shell="chat"]')!,
        ).backgroundColor,
    );
    expect(base).toBe(
      dark ? "rgba(0, 0, 0, 0.42)" : "rgba(255, 255, 255, 0.16)",
    );
    expect(values[0]).toMatch(new RegExp(`/\\s*${dark ? "0.36" : "0.42"}\\)`));
    expect(values[1]).toMatch(new RegExp(`/\\s*${dark ? "0.72" : "0.84"}\\)`));
    await page.evaluate(
      () => (document.documentElement.dataset.riftContrast = "high"),
    );
    expect(await colors()).toEqual(["rgb(32, 32, 32)", "rgb(24, 24, 24)"]);
    await page.evaluate(
      () => delete document.documentElement.dataset.riftContrast,
    );
    await page.emulateMedia({ contrast: "more" });
    expect(await colors()).toEqual(["rgb(32, 32, 32)", "rgb(24, 24, 24)"]);
    await page.emulateMedia({ contrast: "no-preference" });
    await page.evaluate(() => {
      delete document.documentElement.dataset.riftContrast;
      document.documentElement.dataset.riftSidebar = "solid";
    });
    expect(await colors()).toEqual(["rgb(32, 32, 32)", "rgb(24, 24, 24)"]);
  });
}
