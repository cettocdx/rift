import { expect, test } from "@playwright/test";
import type { Locator } from "@playwright/test";
const buildFixture = require("./all-files-build.cjs");
let fixture: { js: string; css: string };
test.beforeAll(async () => {
  fixture = await buildFixture();
});

test("file downloads reveal for keyboard and touch while desktop rows remain compact", async ({
  page,
  browserName,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => {
    errors.push(`Unexpected request: ${route.request().url()}`);
    return route.abort();
  });
  await page.setContent(
    '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><main class="pro-shell"><div id="root"></div></main></body></html>',
  );
  await page.addStyleTag({ content: fixture.css });
  await page.addScriptTag({ content: fixture.js });
  await page.getByRole("button", { name: "Open files" }).click();
  const first = page
    .getByRole("button", { name: /Download (file|first\.txt)$/, exact: false })
    .first();
  await expect(first).toBeAttached();
  const coarse = await page.evaluate(
    () => matchMedia("(pointer: coarse)").matches,
  );
  expect(coarse).toBe(Boolean(info.project.use.hasTouch));
  const opacity = (button: Locator) =>
    button.evaluate((el) => getComputedStyle(el).opacity);
  if (coarse) {
    await expect.poll(() => opacity(first)).toBe("1");
    await expect.poll(async () => (await first.boundingBox())!.width).toBe(44);
  } else {
    await page.mouse.move(0, 0);
    await expect.poll(() => opacity(first)).toBe("0");
    await first.hover();
    await expect.poll(() => opacity(first)).toBe("1");
    await page.mouse.move(0, 0);
    await expect.poll(() => opacity(first)).toBe("0");
    // WebKit's macOS keyboard preference requires Option+Tab to include buttons.
    const tab = browserName === "webkit" ? "Alt+Tab" : "Tab";
    for (
      let step = 0;
      step < 8 &&
      !(await first.evaluate((el) => el === document.activeElement));
      step++
    )
      await page.keyboard.press(tab);
    await expect(first).toBeFocused();
    await expect.poll(() => opacity(first)).toBe("1");
    await expect.poll(async () => (await first.boundingBox())!.width).toBe(24);
  }
  await expect(first).toHaveAccessibleName("Download first.txt");
  await expect(
    page.getByRole("button", { name: "Download second.txt", exact: true }),
  ).toBeAttached();
  const geometry = await first.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const points = [
      [r.left + 3, r.top + 3],
      [r.right - 3, r.top + 3],
      [r.left + 3, r.bottom - 3],
      [r.right - 3, r.bottom - 3],
      [r.left + r.width / 2, r.top + r.height / 2],
    ];
    return {
      width: r.width,
      height: r.height,
      contained:
        r.left >= 0 &&
        r.right <= innerWidth &&
        r.top >= 0 &&
        r.bottom <= innerHeight,
      hit: points.every(([x, y]) =>
        el.contains(document.elementFromPoint(x, y)),
      ),
      opacity: getComputedStyle(el).opacity,
    };
  });
  expect(geometry.contained).toBe(true);
  expect(geometry.hit).toBe(true);
  expect(geometry.height).toBe(coarse ? 44 : 24);
  await page.screenshot({ path: info.outputPath("download-controls.png") });
  if (coarse) await first.tap();
  else await page.keyboard.press("Enter");
  expect(
    await page.evaluate(
      () =>
        (window as Window & { fixtureDownloads?: unknown[] }).fixtureDownloads,
    ),
  ).toEqual([{ url: "https://fixture.invalid/first", filename: "first.txt" }]);
  await page
    .getByRole("button", { name: "Download files", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Batch download (2)" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(first).toBeAttached();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        (window as Window & { fixtureServiceAttempts?: number })
          .fixtureServiceAttempts,
    ),
  ).toBe(0);
  expect(errors).toEqual([]);
  await info.attach("download-control", {
    body: JSON.stringify(geometry),
    contentType: "application/json",
  });
});
