import { expect, test } from "@playwright/test";
const buildFixture = require("./terminal-build.cjs");
let fixture: { js: string; css: string };
test.beforeAll(async () => {
  fixture = await buildFixture();
});
for (const theme of ["light", "dark"]) {
  test(`terminal remains usable through sustained output, hide and resize in ${theme}`, async ({
    page,
  }, info) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/*", (route) => {
      errors.push(`Unexpected network: ${route.request().url()}`);
      return route.abort();
    });
    await page.setContent(
      '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div></body></html>',
    );
    await page.evaluate((value) => {
      (window as any).fixtureTheme = value;
    }, theme);
    await page.addStyleTag({
      content:
        "html,body{margin:0;font-family:system-ui}main{padding:12px}nav{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px}button,input{font:inherit;min-height:40px;max-width:100%}" +
        fixture.css,
    });
    await page.addScriptTag({ content: fixture.js });
    const status = page.locator("[data-terminal-connection-label]");
    await expect(status).toHaveText("Connected");
    const terminal = page.getByRole("textbox", {
      name: "Shell interactive workspace terminal",
    });
    await terminal.focus();
    await terminal.pressSequentially("echo rift", { delay: 10 });
    await terminal.press("Enter");
    await expect
      .poll(() =>
        page.evaluate(() => (window as any).fixtureStats.inputs.join("")),
      )
      .toBe("echo rift\r");
    await page.evaluate(() => {
      void (window as any).fixtureBurst();
    });
    await expect
      .poll(() => page.evaluate(() => (window as any).fixtureStats.acks))
      .toBeGreaterThan(12);
    const draft = page.getByRole("textbox", { name: "Chat draft" });
    await draft.fill("Türkçe taslak korunuyor");
    await page.getByRole("button", { name: "Resize panel" }).click();
    await page.getByRole("button", { name: "Toggle panel" }).click();
    const before = await page.evaluate(() => (window as any).fixtureStats.acks);
    await expect
      .poll(() => page.evaluate(() => (window as any).fixtureStats.acks))
      .toBeGreaterThan(before + 8);
    await page.getByRole("button", { name: "Toggle panel" }).click();
    await page.getByRole("button", { name: "Resize panel" }).click();
    await terminal.focus();
    await terminal.pressSequentially("during-output", { delay: 10 });
    await terminal.press("Control+c");
    await expect
      .poll(() =>
        page.evaluate(() => (window as any).fixtureStats.inputs.join("")),
      )
      .toBe("echo rift\rduring-output\u0003");
    await expect
      .poll(() => page.evaluate(() => (window as any).fixtureStats.done), {
        timeout: 30_000,
      })
      .toBe(true);
    await expect(status).toHaveText("Exited 0");
    await expect(draft).toHaveValue("Türkçe taslak korunuyor");
    const evidence = await page.evaluate(() => {
      const w = window as any;
      const s = w.fixtureStats;
      const t = w.fixtureTerminal;
      const b = t.buffer.active;
      const lines = Array.from({ length: b.length }, (_, i) =>
        b.getLine(i)?.translateToString(true),
      );
      const frames = s.frames.slice().sort((a: number, b: number) => a - b);
      return {
        ...s,
        frames: undefined,
        frameCount: frames.length,
        p95: frames[Math.floor(frames.length * 0.95)],
        p99: frames[Math.floor(frames.length * 0.99)],
        max: Math.max(...frames),
        bufferLength: b.length,
        rows: t.rows,
        tail: lines.slice(-60).join("\n"),
        background: t.options.theme.background,
      };
    });
    expect(evidence.acks).toBe(640);
    expect(evidence.maxInFlight).toBe(1);
    expect(evidence.bytes).toBeGreaterThan(13_000_000);
    expect(evidence.created).toBe(1);
    expect(evidence.detached).toBe(0);
    expect(evidence.bufferLength).toBeLessThanOrEqual(5000 + evidence.rows);
    expect(evidence.tail).toContain("RIFT_END_639");
    expect(evidence.tail).toContain("Türkçe λ 🙂");
    expect(evidence.background).toBe(theme === "light" ? "#fbfbfb" : "#141414");
    expect(errors).toEqual([]);
    await info.attach("terminal-evidence", {
      body: JSON.stringify(evidence, null, 2),
      contentType: "application/json",
    });
    await page.screenshot({ path: info.outputPath(`${theme}-terminal.png`) });
  });
}
