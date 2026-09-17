import { expect, test } from "@playwright/test";
const buildFixture = require("./agent-tray-build.cjs");
let fixture: { js: string; css: string };
test.beforeAll(async () => {
  fixture = await buildFixture();
});
for (const theme of ["light", "dark"]) {
  test(`collaborators stay usable during output updates — ${theme}`, async ({
    page,
  }, info) => {
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
    }, theme);
    await page.addStyleTag({
      content:
        fixture.css +
        `html,body{margin:0;font-family:system-ui;background:var(--background);color:var(--foreground)} main{height:680px;width:760px;display:flex;flex-direction:column;max-width:100vw} article{flex:1;min-height:0;overflow:auto} article p{margin:0;line-height:28px} footer{padding:12px;min-width:0} textarea{width:100%;height:64px;box-sizing:border-box;background:var(--background);color:var(--foreground);border:1px solid var(--border);border-radius:12px;padding:10px}`,
    });
    await page.addScriptTag({ content: fixture.js });
    const tray = page.getByRole("region", { name: "Collaborators" });
    const toggle = tray.getByRole("button", { name: /Collaborators/ });
    const draft = page.getByRole("textbox", { name: "Message RIFT" });
    const transcript = page.getByRole("article", { name: "Transcript" });
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(toggle).toContainText("1 working");
    await draft.fill("İşi durdurmadan bu notu koru.");
    await transcript.evaluate((el) => {
      el.scrollTop = 560;
    });
    const scrollBefore = await transcript.evaluate((el) => el.scrollTop);
    await page.evaluate(() => (window as any).trayFixture.arrive());
    await expect(tray.getByRole("button", { name: /Arrival/ })).toHaveCount(1);
    await expect(draft).toBeFocused();
    expect(await transcript.evaluate((el) => el.scrollTop)).toBe(scrollBefore);
    await toggle.focus();
    await toggle.press("Enter");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await page.evaluate(() => (window as any).trayFixture.finish());
    await expect(toggle).not.toContainText("working");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(toggle).toBeFocused();
    await toggle.press("Space");
    const pixel = tray.getByRole("button", { name: /Pixel/ });
    await pixel.focus();
    await pixel.press("Enter");
    await expect
      .poll(() => page.evaluate(() => (window as any).selectedAgent))
      .toBe("call-0");
    const geometry = [];
    for (const width of [760, 430, 390, 360, 320]) {
      await page
        .locator("main")
        .evaluate((el, w) => (el.style.width = `${w}px`), width);
      const measured = await tray.evaluate((el) => ({
        width: el.getBoundingClientRect().width,
        scrollWidth: el.scrollWidth,
        listHeight: el.querySelector("ul")!.getBoundingClientRect().height,
        buttons: [...el.querySelectorAll("button")].map((b) => ({
          height: b.getBoundingClientRect().height,
          width: b.getBoundingClientRect().width,
        })),
      }));
      expect(measured.scrollWidth).toBeLessThanOrEqual(
        Math.ceil(measured.width),
      );
      expect(measured.listHeight).toBeLessThanOrEqual(132);
      if (info.project.use.hasTouch)
        for (const b of measured.buttons)
          expect(b.height).toBeGreaterThanOrEqual(44);
      geometry.push(measured);
    }
    await toggle.click();
    await page.evaluate(() => (window as any).trayFixture.next());
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(draft).toHaveValue("İşi durdurmadan bu notu koru.");
    expect(errors).toEqual([]);
    await info.attach("geometry", {
      body: JSON.stringify(geometry, null, 2),
      contentType: "application/json",
    });
    await page.screenshot({ path: info.outputPath("collaborators.png") });
  });
}
