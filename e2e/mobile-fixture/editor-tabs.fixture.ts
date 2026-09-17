import { expect, test, type Locator } from "@playwright/test";
const buildFixture = require("./editor-tabs-build.cjs");
let fixture: { js: string; css: string };
test.beforeAll(async () => {
  fixture = await buildFixture();
});

test("editor file selection and closing remain visible, contained and independent", async ({
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
    '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><main class="pro-shell"><div id="root"></div></main></body></html>',
  );
  await page.addStyleTag({ content: fixture.css });
  await page.addScriptTag({ content: fixture.js });
  const strip = page.getByRole("tablist", { name: "Open files" });
  const alpha = page.getByRole("tab", { name: "alpha.ts", exact: true });
  const beta = page.getByRole("tab", { name: "beta.ts", exact: true });
  const closeAlpha = page.getByRole("button", {
    name: "Close alpha.ts",
    exact: true,
  });
  const coarse = Boolean(info.project.use.hasTouch);
  await expect
    .poll(() => strip.evaluate((el) => getComputedStyle(el).scrollbarWidth))
    .toBe("none");
  const opacity = (loc: Locator) =>
    loc.evaluate((el) => getComputedStyle(el).opacity);
  await expect(alpha).toHaveAttribute("aria-selected", "true");
  await page.mouse.move(1, 800);
  if (coarse) {
    await expect.poll(() => opacity(closeAlpha)).toBe("1");
    await expect
      .poll(async () => (await closeAlpha.boundingBox())!.width)
      .toBe(44);
    await expect
      .poll(async () => (await alpha.boundingBox())!.height)
      .toBeGreaterThanOrEqual(44);
  } else {
    await expect.poll(() => opacity(closeAlpha)).toBe("0");
    await closeAlpha.hover();
    await expect.poll(() => opacity(closeAlpha)).toBe("1");
    await page.mouse.move(1, 800);
    await expect.poll(() => opacity(closeAlpha)).toBe("0");
    await expect.poll(async () => (await strip.boundingBox())!.height).toBe(35);
    await expect
      .poll(async () => (await closeAlpha.boundingBox())!.width)
      .toBe(20);
  }
  const checkTarget = async (loc: Locator) => {
    const measure = () =>
      loc.evaluate((el) => {
        const r = el.getBoundingClientRect(),
          parent = el.closest('[role="tablist"]')!.getBoundingClientRect();
        return {
          height: r.height,
          width: r.width,
          contained:
            r.top >= parent.top &&
            r.bottom <= parent.bottom &&
            r.left >= parent.left &&
            r.right <= parent.right,
          hit: [
            [r.left + 3, r.top + 3],
            [r.right - 3, r.top + 3],
            [r.left + 3, r.bottom - 3],
            [r.right - 3, r.bottom - 3],
            [r.left + r.width / 2, r.top + r.height / 2],
          ].every(([x, y]) => el.contains(document.elementFromPoint(x, y))),
        };
      });
    // WebKit updates the scroll hit-test tree after layout; wait for the
    // actual points to resolve rather than assuming scroll completion paints.
    await expect.poll(measure).toMatchObject({ contained: true, hit: true });
    const geometry = await measure();
    if (coarse) {
      expect(geometry.height).toBeGreaterThanOrEqual(44);
      expect(geometry.width).toBeGreaterThanOrEqual(44);
    }
  };
  await checkTarget(closeAlpha);
  await checkTarget(alpha);
  if (coarse) await beta.tap();
  else await beta.click();
  await expect(beta).toHaveAttribute("aria-selected", "true");
  if (coarse) await closeAlpha.tap();
  else {
    await alpha.focus();
    await page.keyboard.press(browserName === "webkit" ? "Alt+Tab" : "Tab");
    await expect(closeAlpha).toBeFocused();
    await expect.poll(() => opacity(closeAlpha)).toBe("1");
    await page.keyboard.press("Enter");
  }
  await expect(alpha).toHaveCount(0);
  await expect(beta).toHaveAttribute("aria-selected", "true");
  expect(
    await page.evaluate(
      () => (window as unknown as { fixtureCalls: unknown[] }).fixtureCalls,
    ),
  ).toEqual([
    { type: "select", path: "src/beta.ts" },
    { type: "close", path: "src/alpha.ts" },
  ]);
  // The scrollbar is visually hidden; horizontal wheel input must still scroll.
  if (!coarse) {
    await strip.hover();
    await page.mouse.wheel(400, 0);
    await expect
      .poll(() => strip.evaluate((el) => el.scrollLeft))
      .toBeGreaterThan(0);
  }
  // Real keyboard tab selection still works with a long horizontally scrolling list.
  await beta.focus();
  await page.keyboard.press("End");
  const last = page.getByRole("tab", {
    name: "descriptive-file-name-9.tsx",
    exact: true,
  });
  await expect(last).toBeFocused();
  await expect(last).toHaveAttribute("aria-selected", "true");
  const lastClose = page.getByRole("button", {
    name: "Close descriptive-file-name-9.tsx",
    exact: true,
  });
  await lastClose.scrollIntoViewIfNeeded();
  await checkTarget(lastClose);
  await checkTarget(last);
  expect(await strip.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(
    true,
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: info.outputPath("editor-tab-controls.png") });
  if (coarse) await lastClose.tap();
  else await lastClose.click();
  await expect(last).toHaveCount(0);
  const next = page.getByRole("tab", {
    name: "descriptive-file-name-8.tsx",
    exact: true,
  });
  await expect(next).toHaveAttribute("aria-selected", "true");
  await next.focus();
  await page.keyboard.press("Home");
  await expect(beta).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(
    page.getByRole("tab", { name: "descriptive-file-name-0.tsx", exact: true }),
  ).toBeFocused();
  const closes = page.getByRole("button", { name: /^Close / });
  while (await closes.count()) {
    const close = closes.first();
    await close.scrollIntoViewIfNeeded();
    if (coarse) await close.tap();
    else await close.click();
  }
  await expect(strip).toHaveCount(0);
  const empty = page.getByText("Editor", { exact: true });
  await expect(empty).toBeVisible();
  await expect
    .poll(async () => (await empty.boundingBox())!.height)
    .toBe(coarse ? 46 : 35);
  expect(errors).toEqual([]);
});
