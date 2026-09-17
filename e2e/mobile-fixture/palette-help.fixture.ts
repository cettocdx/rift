import { test, expect, type Locator, type Page } from "@playwright/test";
const descriptions = {
  goal: "Set, edit, pause, resume, view, or clear the persistent task goal",
  mcp: "Open the integrations workbench for MCP servers and tools",
};
async function hit(locator: Locator) {
  return locator.evaluate((node) => {
    const rect = node.getBoundingClientRect(),
      view = window.visualViewport!;
    const x = rect.left + rect.width / 2,
      y = rect.top + rect.height / 2;
    return {
      height: rect.height,
      width: rect.width,
      within:
        rect.left >= view.offsetLeft &&
        rect.right <= view.offsetLeft + view.width + 1 &&
        rect.top >= view.offsetTop &&
        rect.bottom <= view.offsetTop + view.height + 1,
      hit: [
        [x, y],
        [rect.left + 3, rect.top + 3],
        [rect.right - 3, rect.top + 3],
        [rect.left + 3, rect.bottom - 3],
        [rect.right - 3, rect.bottom - 3],
      ].every(([pointX, pointY]) =>
        node.contains(document.elementFromPoint(pointX, pointY)),
      ),
    };
  });
}
async function settledPalette(page: Page) {
  await page.getByTestId("composer-palette").evaluate((node) =>
    Promise.all(
      node
        .getAnimations({ subtree: true })
        .filter(
          (animation) =>
            animation.effect?.getComputedTiming().endTime !== Infinity,
        )
        .map((animation) => animation.finished.catch(() => {})),
    ),
  );
}
async function frames(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}
async function assertBounds(page: Page) {
  const bounds = await page.getByTestId("composer-palette").evaluate((node) => {
    const r = node.getBoundingClientRect(),
      v = window.visualViewport!;
    return {
      left: r.left,
      right: r.right,
      top: r.top,
      bottom: r.bottom,
      viewport: {
        left: v.offsetLeft,
        right: v.offsetLeft + v.width,
        top: v.offsetTop,
        bottom: v.offsetTop + v.height,
      },
      documentWidth: document.documentElement.scrollWidth,
      documentHeight: document.documentElement.scrollHeight,
      innerWidth,
      innerHeight,
      scrollY,
    };
  });
  expect(bounds.left).toBeGreaterThanOrEqual(bounds.viewport.left);
  expect(bounds.right).toBeLessThanOrEqual(bounds.viewport.right + 1);
  expect(bounds.top).toBeGreaterThanOrEqual(bounds.viewport.top);
  expect(bounds.bottom).toBeLessThanOrEqual(bounds.viewport.bottom + 1);
  expect(bounds.documentWidth).toBeLessThanOrEqual(bounds.innerWidth);
  expect(bounds.documentHeight).toBeLessThanOrEqual(bounds.innerHeight);
  expect(bounds.scrollY).toBe(0);
}
async function readableHelp(page: Page, command: keyof typeof descriptions) {
  const desc = page.locator(
    '[data-ui="composer-palette-selected-description"]',
  );
  const usage = page.locator('[data-ui="composer-palette-selected-usage"]');
  const details = page.locator('[data-ui="composer-palette-details"]');
  await expect(desc).toHaveText(descriptions[command]);
  await expect(usage).toContainText(`/${command}`);
  if (command === "goal")
    await expect(usage).toHaveText(
      "/goal [view|pause|resume|clear|edit <objective>|<objective>]",
    );
  else await expect(usage).toHaveText("/mcp");
  for (const part of [desc, usage]) {
    const measured = await part.evaluate((node) => {
      const container = node.closest('[data-ui="composer-palette-details"]')!;
      const box = container.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(node);
      return {
        whiteSpace: getComputedStyle(node).whiteSpace,
        textOverflow: getComputedStyle(node).textOverflow,
        rects: Array.from(range.getClientRects()).map((rect) => ({
          width: rect.width,
          left: rect.left,
          right: rect.right,
        })),
        container: { left: box.left, right: box.right },
      };
    });
    expect(measured.rects.length).toBeGreaterThan(0);
    expect(measured.rects.some((rect) => rect.width > 0)).toBe(true);
    for (const rect of measured.rects) {
      expect(rect.left).toBeGreaterThanOrEqual(measured.container.left);
      expect(rect.right).toBeLessThanOrEqual(measured.container.right + 1);
    }
    expect(measured.whiteSpace).not.toBe("nowrap");
    expect(measured.textOverflow).not.toBe("ellipsis");
  }
  await settledPalette(page);
  const geometry = await details.boundingBox();
  expect(geometry!.height).toBeGreaterThanOrEqual(44);
  if (
    page.viewportSize()!.height >= 800 &&
    (await page.evaluate(() => window.visualViewport!.height >= 800))
  ) {
    const use = page.getByRole("button", {
      name: `Use /${command}`,
      exact: true,
    });
    await expect.poll(() => details.evaluate((node) => node.scrollTop)).toBe(0);
    await fullTarget(page, use);
    const inside = await use.evaluate((node) => {
      const r = node.getBoundingClientRect(),
        p = node.closest('[data-ui="composer-palette-details"]')!;
      const box = p.getBoundingClientRect();
      return (
        r.top >= box.top + p.clientTop &&
        r.bottom <= box.top + p.clientTop + p.clientHeight
      );
    });
    expect(inside).toBe(true);
  }
  // Keyboard scrolling is an actual supported browser input on both engines.
  // Mobile WebKit does not expose mouse.wheel; this does not claim touch-swipe coverage.
  await page.getByRole("textbox", { name: "Message RIFT" }).press("F1");
  await expect(details).toBeFocused();
  await details.press("Home");
  await expect.poll(() => details.evaluate((node) => node.scrollTop)).toBe(0);
  await page.screenshot({
    path: test
      .info()
      .outputPath(`${command}-${page.viewportSize()!.height}-help-start.png`),
    animations: "allow",
  });
  await details.press("End");
  await expect
    .poll(() =>
      details.evaluate(
        (node) => node.scrollHeight - node.clientHeight - node.scrollTop,
      ),
    )
    .toBeLessThanOrEqual(1);
  await details.press("Escape");
  await assertBounds(page);
}
async function prepare(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (
      url.origin !== "http://127.0.0.1:3039" ||
      url.pathname.startsWith("/api/")
    ) {
      errors.push(`Unexpected request ${url.pathname}`);
      return route.abort();
    }
    return route.continue();
  });
  await page.goto("/lab/composer?compact");
  return errors;
}
test("selected command help remains readable in normal and short viewports", async ({
  page,
}, info) => {
  const errors = await prepare(page);
  const draft = page.getByRole("textbox", { name: "Message RIFT" });
  const coarse = Boolean(info.project.use.hasTouch);
  for (const height of [page.viewportSize()!.height, 320]) {
    await page.setViewportSize({ width: page.viewportSize()!.width, height });
    await page.evaluate(
      (dark) => document.documentElement.classList.toggle("dark", dark),
      height === 320,
    );
    for (const command of ["goal", "mcp"] as const) {
      const original = `Keep my draft /${command}`;
      await draft.fill(original);
      await readableHelp(page, command);
      const selected = page.getByRole("option", { selected: true });
      const measured = await hit(selected);
      expect(measured.within).toBe(true);
      expect(measured.hit).toBe(true);
      if (coarse) expect(measured.height).toBeGreaterThanOrEqual(44);
      await expect(draft).toHaveValue(original);
      await expect(
        page.getByRole("status", { name: "Fixture action" }),
      ).toHaveText("");
      await draft.press("F1");
      await expect(
        page.locator('[data-ui="composer-palette-details"]'),
      ).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(draft).toBeFocused();
      await expect(draft).toHaveValue(original);
      await info.attach(`${command}-${height}-geometry`, {
        body: JSON.stringify({
          row: measured,
          details: await page
            .locator('[data-ui="composer-palette-details"]')
            .boundingBox(),
        }),
        contentType: "application/json",
      });
      await page.screenshot({
        path: info.outputPath(`${command}-${height}.png`),
        animations: "allow",
      });
      if (coarse) {
        const use = page.getByRole("button", {
          name: `Use /${command}`,
          exact: true,
        });
        const target = await hit(use);
        expect(target.hit).toBe(true);
        expect(target.within).toBe(true);
        expect(target.height).toBeGreaterThanOrEqual(44);
        await use.tap();
      } else await draft.press("Enter");
      await expect(page.getByTestId("composer-palette")).toHaveCount(0);
      await expect(draft).toBeFocused();
      await expect(draft).toHaveValue(
        new RegExp(`^Keep my draft /${command}\\s*$`),
      );
      await expect(
        page.getByRole("status", { name: "Fixture action" }),
      ).toHaveText("");
      const send = page.getByRole("button", {
        name: "Send message",
        exact: true,
      });
      expect((await hit(send)).hit).toBe(true);
      await assertNoDocumentScroll(page);
      await draft.fill("");
    }
  }
  await draft.fill("Confirm safe fixture submission");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.getByRole("status", { name: "Fixture action" })).toHaveText(
    "submitted",
  );
  expect(errors).toEqual([]);
});
async function assertNoDocumentScroll(page: Page) {
  expect(
    await page.evaluate(() => ({
      scrollY,
      overX: document.documentElement.scrollWidth > innerWidth,
      overY: document.documentElement.scrollHeight > innerHeight,
    })),
  ).toEqual({ scrollY: 0, overX: false, overY: false });
}
test("visual viewport resize and inspection preserve draft and bounded help", async ({
  page,
}, info) => {
  const errors = await prepare(page);
  const draft = page.getByRole("textbox", { name: "Message RIFT" });
  await draft.fill("/");
  if (info.project.use.hasTouch) {
    const list = page.locator('[data-ui="composer-palette-scroll"]');
    const goal = page.getByRole("option").filter({
      has: page.locator('[data-ui="composer-palette-item-label"]', {
        hasText: "/mcp",
      }),
    });
    const box = await list.boundingBox();
    for (let i = 0; i < 24; i++) {
      const reachable = await goal.evaluate((node) => {
        const r = node.getBoundingClientRect(),
          p = node
            .closest('[data-ui="composer-palette-scroll"]')!
            .getBoundingClientRect();
        return r.top >= p.top && r.bottom <= p.bottom;
      });
      if (reachable) break;
      await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
      if (info.project.name.startsWith("webkit"))
        await list.evaluate((node) => node.scrollBy(0, 100));
      else await page.mouse.wheel(0, 100);
      await frames(page);
    }
    await expect(draft).toHaveValue("/");
    await goal.tap();
    await expect(draft).toHaveValue("/");
    await readableHelp(page, "mcp");
    await expect(
      page.getByRole("button", { name: "Use /mcp", exact: true }),
    ).toBeVisible();
  }
  await draft.fill("/");
  await draft.press("End");
  await expect
    .poll(
      async () => (await hit(page.getByRole("option", { selected: true }))).hit,
    )
    .toBe(true);
  await assertBounds(page);
  await draft.press("Home");
  await expect
    .poll(
      async () => (await hit(page.getByRole("option", { selected: true }))).hit,
    )
    .toBe(true);
  await assertBounds(page);
  await expect(page.getByRole("status", { name: "Fixture action" })).toHaveText(
    "",
  );
  await draft.fill("/goal");
  // Explicit contract simulation only: no actual iOS software keyboard is opened.
  await page.evaluate(() => {
    const real = window.visualViewport!;
    Reflect.set(window, "__paletteOriginalViewport", real);
    const contract = new EventTarget();
    Object.defineProperties(contract, {
      height: { value: 400 },
      width: { value: innerWidth },
      offsetLeft: { value: 0 },
      offsetTop: { value: 0 },
      scale: { value: 1 },
    });
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: contract,
    });
    contract.dispatchEvent(new Event("resize"));
    // Production listeners were attached to the original object; notify that event source too.
    real.dispatchEvent(new Event("resize"));
  });
  await frames(page);
  await readableHelp(page, "goal");
  await assertBounds(page);
  await expect(draft).toHaveValue("/goal");
  await page.screenshot({
    path: info.outputPath("viewport400-help.png"),
    animations: "allow",
  });
  await page.evaluate(() => {
    const real = Reflect.get(window, "__paletteOriginalViewport");
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: real,
    });
    real.dispatchEvent(new Event("resize"));
  });
  await frames(page);
  await assertBounds(page);
  await draft.press("Escape");
  await expect(page.getByTestId("composer-palette")).toHaveCount(0);
  await expect(draft).toBeFocused();
  await expect(page.getByRole("status", { name: "Fixture action" })).toHaveText(
    "",
  );
  await page.screenshot({
    path: info.outputPath("viewport400-dismissed.png"),
    animations: "allow",
  });
  expect(errors).toEqual([]);
});

async function fullTarget(page: Page, target: Locator) {
  const geometry = await target.evaluate((node) => {
    const r = node.getBoundingClientRect();
    const p = node.closest('[data-testid="composer-palette"]')!;
    const box = p.getBoundingClientRect();
    return {
      top: r.top,
      bottom: r.bottom,
      height: r.height,
      paneTop: box.top + p.clientTop,
      paneBottom: box.top + p.clientTop + p.clientHeight,
      paneHeight: p.clientHeight,
    };
  });
  await test.info().attach("full-target-geometry", {
    body: JSON.stringify(geometry),
    contentType: "application/json",
  });
  expect(geometry.top).toBeGreaterThanOrEqual(geometry.paneTop);
  expect(geometry.bottom).toBeLessThanOrEqual(geometry.paneBottom);
  const hitStarted = Date.now();
  await expect.poll(async () => (await hit(target)).hit).toBe(true);
  await test.info().attach("target-hit-wait-ms", {
    body: String(Date.now() - hitStarted),
    contentType: "text/plain",
  });
  expect((await hit(target)).within).toBe(true);
  await assertBounds(page);
  return geometry;
}
test("240px viewport retains reachable command help and Use control", async ({
  page,
}, info) => {
  const errors = await prepare(page);
  await page.setViewportSize({
    width: page.viewportSize()!.width,
    height: 240,
  });
  const draft = page.getByRole("textbox", { name: "Message RIFT" });
  for (const command of ["goal", "mcp"] as const) {
    await draft.fill(`/${command}`);
    await settledPalette(page);
    const selected = page.getByRole("option", { selected: true });
    const row = await fullTarget(page, selected);
    await draft.press("F1");
    const details = page.locator('[data-ui="composer-palette-details"]');
    await expect(details).toBeFocused();
    const back = page.getByRole("button", {
      name: "Back to commands",
      exact: true,
    });
    const backGeometry = await fullTarget(page, back);
    if (info.project.use.hasTouch) await back.tap();
    else await back.click();
    await expect(draft).toBeFocused();
    await expect(draft).toHaveValue(`/${command}`);
    await fullTarget(page, selected);
    await draft.press("F1");
    await details.press("End");
    await expect
      .poll(() =>
        page
          .getByTestId("composer-palette")
          .evaluate(
            (node) => node.scrollHeight - node.clientHeight - node.scrollTop,
          ),
      )
      .toBeLessThanOrEqual(1);
    const use = page.getByRole("button", {
      name: `Use /${command}`,
      exact: true,
    });
    const useGeometry = await fullTarget(page, use);
    if (info.project.use.hasTouch)
      for (const geometry of [row, backGeometry, useGeometry])
        expect(geometry.height).toBeGreaterThanOrEqual(44);
    await info.attach(`${command}-240-targets`, {
      body: JSON.stringify({ row, back: backGeometry, use: useGeometry }),
      contentType: "application/json",
    });
    await page.screenshot({
      path: info.outputPath(`${command}-240.png`),
      animations: "allow",
    });
    if (info.project.use.hasTouch) await use.tap();
    else await use.click();
    await expect(draft).toHaveValue(command === "goal" ? "/goal " : "/mcp");
    await expect(draft).toBeFocused();
    await expect
      .poll(() =>
        draft.evaluate((node) => ({
          start: (node as HTMLTextAreaElement).selectionStart,
          end: (node as HTMLTextAreaElement).selectionEnd,
        })),
      )
      .toEqual({
        start: command === "goal" ? 6 : 4,
        end: command === "goal" ? 6 : 4,
      });
    await expect(
      page.getByRole("status", { name: "Fixture action" }),
    ).toHaveText("");
    await assertNoDocumentScroll(page);
  }
  expect(errors).toEqual([]);
});
