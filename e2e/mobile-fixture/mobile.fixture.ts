import { expect, test } from "@playwright/test";

const browserErrors = new WeakMap<object, string[]>();
test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  browserErrors.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) =>
    new URL(route.request().url()).origin === "http://127.0.0.1:3037"
      ? route.continue()
      : route.abort(),
  );
});
test.afterEach(async ({ page }) => {
  expect(browserErrors.get(page)).toEqual([]);
});

test("shared input and portal preserve mobile typing and return focus", async ({
  page,
}) => {
  await page.goto("/lab/focus");
  const input = page.getByPlaceholder("Input focus");
  await expect(input).toBeVisible();
  await expect(input).not.toBeFocused();
  await input.tap();
  await input.fill("Mobile draft – İstanbul 日本語");
  const trigger = page.getByRole("button", { name: "Open popover" });
  await trigger.tap();
  const portalInput = page.getByPlaceholder("Portal focus");
  await expect(portalInput).toBeFocused();
  await portalInput.fill("Portal draft");
  const box = await portalInput.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  await page.keyboard.press("Escape");
  await expect(portalInput).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await expect(input).toHaveValue("Mobile draft – İstanbul 日本語");
});

test("fixture route links and browser history work on touch viewports", async ({
  page,
}) => {
  await page.goto("/lab/browser?page=1");
  await page.getByRole("link", { name: "Go to page 2", exact: true }).tap();
  await expect(page.getByRole("heading")).toHaveText("Browser check · page 2");
  await page.goBack();
  await expect(page.getByRole("heading")).toHaveText("Browser check · page 1");
});

for (const width of [360, 390]) {
  test(`transcript retains its reading anchor and follows new output at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    let decode!: () => void;
    const imageGate = new Promise<void>((resolve) => {
      decode = resolve;
    });
    await page.route("**/scroll-fixture.svg", async (route) => {
      await imageGate;
      await route.fulfill({
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><rect width="1600" height="900" fill="#163b42"/></svg>',
      });
    });
    await page.goto("/lab/scroll");
    const surface = page.getByTestId("scroll-surface");
    await expect(surface).toBeVisible();
    // The harness wraps only the fixture debug toolbar for touch controls.
    const control = (name: string) =>
      page.getByRole("button", { name, exact: true }).tap();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await control("Latest");
    await expect
      .poll(() =>
        surface.evaluate((e) =>
          Math.abs(e.scrollHeight - e.clientHeight - e.scrollTop),
        ),
      )
      .toBeLessThan(2);
    await surface.evaluate((e) => {
      const anchor = e.querySelector('[data-testid="paragraph-12"]')!;
      e.scrollTop +=
        anchor.getBoundingClientRect().top - e.getBoundingClientRect().top;
      (window as Window & { originalScroll?: Element }).originalScroll = e;
    });
    await expect(page.getByTestId("following")).toHaveText("Reading");
    const offset = () =>
      page
        .getByTestId("paragraph-12")
        .evaluate(
          (e) =>
            e.getBoundingClientRect().top -
            document
              .querySelector('[data-testid="scroll-surface"]')!
              .getBoundingClientRect().top,
        );
    const original = await offset();
    await control("Append output");
    await expect
      .poll(async () => Math.abs((await offset()) - original))
      .toBeLessThan(2);
    await control("Toggle panel");
    await expect
      .poll(() =>
        page
          .locator("aside")
          .evaluate((e) =>
            Math.abs(
              e.getBoundingClientRect().width - window.innerWidth * 0.45,
            ),
          ),
      )
      .toBeLessThan(1);
    await expect
      .poll(async () => Math.abs((await offset()) - original))
      .toBeLessThan(2);
    await control("Toggle panel");
    await expect
      .poll(() =>
        page.locator("aside").evaluate((e) => e.getBoundingClientRect().width),
      )
      .toBeLessThan(1);
    await expect
      .poll(async () => Math.abs((await offset()) - original))
      .toBeLessThan(2);
    await control("Insert image");
    const image = page.locator('[data-ui="inline-image-frame"] img');
    await expect(image).toBeVisible();
    const frame = page.locator('[data-ui="inline-image-frame"]');
    const frameBefore = await frame.boundingBox();
    await expect
      .poll(async () => Math.abs((await offset()) - original))
      .toBeLessThan(2);
    // Force the offscreen fixture request to model a previously-visible image
    // finishing after the user scrolls away; preserve the real Next renderer.
    await image.evaluate((element: HTMLImageElement) => {
      element.loading = "eager";
    });
    decode();
    await expect
      .poll(() =>
        image.evaluate(
          (e: HTMLImageElement) => e.complete && e.naturalWidth > 0,
        ),
      )
      .toBe(true);
    const frameAfter = await frame.boundingBox();
    expect(Math.abs(frameAfter!.height - frameBefore!.height)).toBeLessThan(1);
    await expect
      .poll(async () => Math.abs((await offset()) - original))
      .toBeLessThan(2);
    expect(
      await surface.evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
    ).toBe(true);
    await control("Latest");
    await control("Append output");
    await expect
      .poll(() =>
        surface.evaluate((e) =>
          Math.abs(e.scrollHeight - e.clientHeight - e.scrollTop),
        ),
      )
      .toBeLessThan(2);
    expect(
      await surface.evaluate(
        (e) =>
          e ===
          (window as Window & { originalScroll?: Element }).originalScroll,
      ),
    ).toBe(true);
    await testInfo.attach("geometry", {
      contentType: "application/json",
      body: JSON.stringify({
        width,
        engine: testInfo.project.name,
        readingAnchor: original,
        frameHeightBeforeDecode: frameBefore!.height,
        frameHeightAfterDecode: frameAfter!.height,
        transcriptWidth: await surface.evaluate((e) => e.clientWidth),
      }),
    });
    await page.screenshot({
      path: testInfo.outputPath("mobile-transcript.png"),
    });
  });
}
