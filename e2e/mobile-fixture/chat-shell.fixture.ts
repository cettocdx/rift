import { expect, test, type Locator, type Page } from "@playwright/test";

async function visibleHit(locator: Locator, bottom: number) {
  await expect(locator).toBeVisible();
  await expect
    .poll(() =>
      locator.evaluate((element, bottom) => {
        const r = element.getBoundingClientRect();
        const visibleTop = window.visualViewport?.offsetTop ?? 0;
        return {
          top: r.top,
          bottom: r.bottom,
          fits: r.top >= visibleTop && r.bottom <= bottom + 1,
          hit: element.contains(
            document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2),
          ),
        };
      }, bottom),
    )
    .toMatchObject({ hit: true, fits: true });
  const r = await locator.boundingBox();
  expect(r!.y).toBeGreaterThanOrEqual(0);
  expect(r!.y + r!.height).toBeLessThanOrEqual(bottom + 1);
}
async function openShell(page: Page, query = "") {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) =>
    new URL(route.request().url()).origin === "http://127.0.0.1:3038"
      ? route.continue()
      : route.abort(),
  );
  await page.goto(`/lab/composer${query}`);
  await expect(
    page.getByRole("textbox", { name: "Message RIFT" }),
  ).toBeVisible();
  return errors;
}

for (const height of [400, 480]) {
  test(`question and draft actions remain reachable at ${height}px layout height`, async ({
    page,
  }, info) => {
    const errors = await openShell(page);
    const width = info.project.use.viewport!.width;
    const availableHeight = width < 768 ? height : 900;
    const draft = page.getByRole("textbox", { name: "Message RIFT" });
    const content = Array.from(
      { length: 12 },
      (_, i) => `Draft line ${i + 1}`,
    ).join("\n");
    await draft.fill(content);
    await page.setViewportSize({ width, height: availableHeight });
    const send = page.getByRole("button", { name: "Send message" });
    await revealInSurface(page, send, availableHeight);
    const question = page.getByRole("region", { name: "Agent question" });
    const list = question.locator(":scope > div > div").first();
    await revealInSurface(page, list, availableHeight);
    const lastOption = question.getByRole("radio", { name: /^Option 3/ });
    let reached = false;
    for (let attempt = 0; attempt < 24; attempt++) {
      reached = await lastOption.evaluate((element) => {
        const r = element.getBoundingClientRect();
        return element.contains(
          document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2),
        );
      });
      if (reached) break;
      const box = await list.boundingBox();
      await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
      if (info.project.name.startsWith("webkit") && info.project.use.isMobile) {
        // Mobile WebKit rejects Playwright wheel input. Exercise its actual
        // overflow scroller, then tap coordinates; this is not an OS swipe.
        await list.evaluate((e) => e.scrollBy(0, 30));
      } else await page.mouse.wheel(0, 30);
      await page.evaluate(() => new Promise(requestAnimationFrame));
    }
    expect(reached).toBe(true);
    const optionBox = await lastOption.boundingBox();
    await page.mouse.click(
      optionBox!.x + optionBox!.width / 2,
      optionBox!.y + optionBox!.height / 2,
    );
    await expect(lastOption).toHaveAttribute("aria-checked", "true");
    if (width < 768)
      expect(await list.evaluate((e) => e.scrollTop)).toBeGreaterThan(0);
    await question
      .getByRole("textbox")
      .fill("Keep the work and test the smallest change.");
    await revealInSurface(
      page,
      question.getByRole("button", { name: "Send", exact: true }),
      availableHeight,
    );
    await revealInSurface(page, send, availableHeight);
    await expect(draft).toHaveValue(content);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    const geometry = await page.evaluate(() => {
      const box = (selector: string) => {
        const e = document.querySelector(selector)!;
        const r = e.getBoundingClientRect();
        return {
          top: r.top,
          bottom: r.bottom,
          height: r.height,
          scrollHeight: e.scrollHeight,
          clientHeight: e.clientHeight,
        };
      };
      return {
        viewport: { height: innerHeight, visualHeight: visualViewport!.height },
        route: box("[data-rift-route-shell]"),
        question: box('[data-ui="question-dock"]'),
        composer: box('[data-ui="composer-region"]'),
        send: box('[aria-label="Send message"]'),
      };
    });
    await info.attach("short-layout-geometry", {
      body: JSON.stringify(geometry, null, 2),
      contentType: "application/json",
    });
    await page.screenshot({ path: info.outputPath("short-layout.png") });
    await question.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.getByLabel("Fixture submitted response")).toContainText(
      "Keep the work and test the smallest change.",
    );
    await expect(draft).toHaveValue(content);
    await page.setViewportSize({ width, height: 844 });
    await visibleHit(send, 844);
    await expect(draft).toHaveValue(content);
    if (width < 768) {
      await page.setViewportSize({ width: 700, height: 360 });
      await revealInSurface(page, send, 360);
      await revealInSurface(
        page,
        question.getByRole("button", { name: "Sent", exact: true }),
        360,
      );
      await expect(draft).toHaveValue(content);
      await page.screenshot({ path: info.outputPath("short-landscape.png") });
    }
    expect(errors).toEqual([]);
  });
}

test("visible-viewport-only resize keeps the focused composer above the simulated keyboard", async ({
  page,
}, info) => {
  const initial = info.project.use.viewport!;
  const mobile = Boolean(info.project.use.hasTouch);
  await page.addInitScript((initial) => {
    const viewport = new EventTarget();
    const values = {
      height: initial.height,
      width: initial.width,
      offsetTop: 0,
      offsetLeft: 0,
      scale: 1,
      pageTop: 0,
      pageLeft: 0,
    };
    for (const name of Object.keys(values))
      Object.defineProperty(viewport, name, {
        get: () => values[name as keyof typeof values],
      });
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: viewport,
    });
    Object.assign(window, {
      __fixtureViewport: (next: Partial<typeof values>) => {
        Object.assign(values, next);
        viewport.dispatchEvent(new Event("resize"));
        viewport.dispatchEvent(new Event("scroll"));
      },
    });
    // This API contract test does not synthesize an OS keyboard or Safari UI.
  }, initial);
  const errors = await openShell(page);
  const draft = page.getByRole("textbox", { name: "Message RIFT" });
  const content = Array.from(
    { length: 12 },
    (_, i) => `Keep draft line ${i + 1}`,
  ).join("\n");
  await draft.fill(content);
  await page.evaluate(() => {
    (
      window as unknown as {
        __fixtureViewport: (next: { height: number }) => void;
      }
    ).__fixtureViewport({ height: 400 });
  });
  const send = page.getByRole("button", { name: "Send message" });
  // The production observer applies viewport events on the next animation frame.
  // Wait for that contract before attempting to scroll its newly sized surface.
  if (mobile)
    await expect(page.locator("[data-rift-route-shell]")).toHaveCSS(
      "height",
      "400px",
    );
  await revealInSurface(page, send, mobile ? 400 : initial.height);
  const result = await send.evaluate((element) => ({
    bottom: element.getBoundingClientRect().bottom,
    visibleBottom: visualViewport!.offsetTop + visualViewport!.height,
    layoutHeight: innerHeight,
  }));
  await info.attach("visual-only-geometry", {
    body: JSON.stringify(result, null, 2),
    contentType: "application/json",
  });
  expect(result.layoutHeight).toBe(initial.height);
  await revealInSurface(page, send, mobile ? 400 : initial.height);
  const route = page.locator("[data-rift-route-shell]");
  if (mobile) await expect(route).toHaveCSS("height", "400px");
  else await expect(route).not.toHaveAttribute("data-rift-visible-viewport");
  await page.screenshot({ path: info.outputPath("visual-viewport.png") });
  await page.evaluate(() => {
    (
      window as unknown as {
        __fixtureViewport: (next: { offsetTop: number }) => void;
      }
    ).__fixtureViewport({ offsetTop: 40 });
  });
  if (mobile) {
    await expect
      .poll(() => route.evaluate((e) => e.getBoundingClientRect().top))
      .toBe(40);
    await visibleHit(send, 440);
    const settings = page.getByRole("button", {
      name: "Chat settings",
      exact: true,
    });
    await settings.click();
    const panel = page.getByRole("dialog", {
      name: "Chat settings",
      exact: true,
    });
    await expect(panel).toBeVisible();
    // First portal attachment must immediately follow the reported viewport.
    await expect
      .poll(() => panel.evaluate((e) => e.getBoundingClientRect().bottom))
      .toBeCloseTo(440, 0);
    await visibleHit(
      panel.getByRole("button", { name: "Close chat settings" }),
      440,
    );
    await page.evaluate(() => {
      (
        window as unknown as {
          __fixtureViewport: (next: {
            height: number;
            offsetTop: number;
          }) => void;
        }
      ).__fixtureViewport({ height: 320, offsetTop: 80 });
    });
    await expect
      .poll(() => panel.evaluate((e) => e.getBoundingClientRect().bottom))
      .toBeCloseTo(400, 0);
    await visibleHit(
      panel.getByRole("button", { name: "Close chat settings" }),
      400,
    );
    await panel.getByRole("button", { name: "Close chat settings" }).click();
    await expect(panel).not.toBeVisible();
    await expect(draft).toHaveValue(content);
    await page.evaluate(() => {
      (
        window as unknown as {
          __fixtureViewport: (next: {
            height: number;
            offsetTop: number;
          }) => void;
        }
      ).__fixtureViewport({ height: 400, offsetTop: 40 });
    });
    await expect(route).toHaveCSS("height", "400px");
    const overflowBefore = await page.evaluate(
      () => document.body.style.overflow,
    );
    const opener = page.getByRole("button", {
      name: "Open navigation",
      exact: true,
    });
    // Use an explicit keyboard entry so both engines share a focused opener;
    // mobile WebKit taps do not necessarily focus buttons.
    await opener.focus();
    await opener.press("Enter");
    const drawer = page.getByRole("dialog", {
      name: "Navigation",
      exact: true,
    });
    // Actual Sidebar/header/GitHub/account components; auth, query and route
    // dispatch are offline service adapters. No physical keyboard is opened.
    await expect(drawer).toBeVisible();
    await expect
      .poll(() =>
        drawer.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          return { top: rect.top, bottom: rect.bottom };
        }),
      )
      .toEqual({ top: 40, bottom: 440 });
    const theme = drawer.getByRole("button", { name: /Switch to .* theme/ });
    await expect(theme).toBeFocused();
    const account = drawer.getByRole("button", {
      name: "Account menu for Google Fixture, Pro",
      exact: true,
    });
    await visibleHit(account, 440);
    // The Google-shaped avatar URL is deliberately blocked by openShell. The
    // production Avatar fallback must preserve the account's initials/name.
    await expect(account.locator('[data-slot="avatar-fallback"]')).toHaveText(
      "GF",
    );
    await expect(account.getByTestId("sidebar-user-display-name")).toHaveText(
      "Google Fixture",
    );
    await revealDrawerControl(
      drawer.getByRole("button", { name: "Add repositories", exact: true }),
    );
    await visibleHit(
      drawer.getByRole("button", { name: "Add repositories", exact: true }),
      440,
    );
    await revealDrawerControl(
      drawer.getByRole("button", { name: "More", exact: true }),
    );
    await drawer.getByRole("button", { name: "More", exact: true }).click();
    await visibleHit(account, 440);
    const plugins = drawer.getByRole("button", {
      name: "Plugins",
      exact: true,
    });
    await revealDrawerControl(plugins);
    await visibleHit(plugins, 440);
    await page.screenshot({
      path: info.outputPath("real-sidebar-visible-viewport.png"),
    });
    await plugins.click();
    await expect(drawer).toHaveCount(0);
    await expect
      .poll(() => page.evaluate(() => Reflect.get(window, "fixtureNavigation")))
      .toContain("/plugins");
    await expect(
      page.getByRole("button", { name: "Open navigation", exact: true }),
    ).toBeFocused();
    await expect(draft).toHaveValue(content);
    expect(await page.evaluate(() => document.body.style.overflow)).toBe(
      overflowBefore,
    );
    await opener.focus();
    await opener.press("Enter");
    await expect(drawer).toBeVisible();
    const closeNavigation = drawer.getByRole("button", {
      name: "Close navigation",
      exact: true,
    });
    await revealDrawerControl(closeNavigation);
    await visibleHit(closeNavigation, 440);
    await closeNavigation.click();
    await expect(drawer).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Open navigation", exact: true }),
    ).toBeFocused();
    await expect(draft).toHaveValue(content);
    await opener.focus();
    await opener.press("Enter");
    await expect(drawer).toBeVisible();
    await page.setViewportSize({ width: 900, height: initial.height });
    await expect(drawer).toHaveCount(0);
    expect(await page.evaluate(() => document.body.style.overflow)).toBe(
      overflowBefore,
    );
    await page.setViewportSize(initial);
    await expect(drawer).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(drawer).toHaveCount(0);
    expect(await page.evaluate(() => document.body.style.overflow)).toBe(
      overflowBefore,
    );
    await expect(route).toHaveCSS("height", "400px");
    await revealInSurface(page, send, 440);
    await expect(draft).toHaveValue(content);
  }
  await page.evaluate(() => {
    (
      window as unknown as {
        __fixtureViewport: (next: { scale: number }) => void;
      }
    ).__fixtureViewport({ scale: 2 });
  });
  await expect(route).not.toHaveAttribute("data-rift-visible-viewport");
  await expect
    .poll(() =>
      route.evaluate(
        (e, height) => Math.abs(e.getBoundingClientRect().height - height),
        initial.height,
      ),
    )
    .toBeLessThan(1);
  await page.evaluate((initial) => {
    (
      window as unknown as {
        __fixtureViewport: (next: {
          scale: number;
          height: number;
          offsetTop: number;
        }) => void;
      }
    ).__fixtureViewport({ scale: 1, height: initial.height, offsetTop: 0 });
  }, initial);
  await visibleHit(send, initial.height);
  await expect(draft).toHaveValue(content);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  expect(errors).toEqual([]);
});

async function revealInSurface(page: Page, target: Locator, height: number) {
  // Exercise the actual bounded surface scroller; no locator click auto-scroll.
  await target.evaluate((element) => {
    const surface = element.closest("[data-rift-chat-surface]")!;
    const r = element.getBoundingClientRect();
    const viewport = surface.getBoundingClientRect();
    surface.scrollBy(
      0,
      (r.top + r.bottom - viewport.top - viewport.bottom) / 2,
    );
  });
  await visibleHit(target, height);
}

async function revealDrawerControl(target: Locator) {
  // Exercise actual overflow containers; do not rely on locator click scrolling
  // or change document geometry to make a hidden control appear reachable.
  await target.evaluate((element) => {
    for (
      let parent = element.parentElement;
      parent;
      parent = parent.parentElement
    ) {
      if (
        /(auto|scroll)/.test(getComputedStyle(parent).overflowY) &&
        parent.scrollHeight > parent.clientHeight
      ) {
        const rect = element.getBoundingClientRect();
        const clip = parent.getBoundingClientRect();
        parent.scrollBy(
          0,
          (rect.top + rect.bottom - clip.top - clip.bottom) / 2,
        );
      }
      if (parent.hasAttribute("data-mobile-navigation-drawer")) break;
    }
  });
}

for (const [height, goal] of [
  [320, true],
  [240, false],
] as const) {
  test(`fixed composer controls remain reachable at ${height}px with goal=${goal}`, async ({
    page,
  }, info) => {
    test.skip(!info.project.use.isMobile, "Small mobile-height edge only");
    const errors = await openShell(page, goal ? "?goal" : "?multi");
    const draft = page.getByRole("textbox", { name: "Message RIFT" });
    const content = Array.from(
      { length: 12 },
      (_, i) => `Keep draft ${i + 1}`,
    ).join("\n");
    await draft.fill(content);
    await page.setViewportSize({
      width: info.project.use.viewport!.width,
      height,
    });
    expect(
      (await page.locator('[data-ui="composer-textarea"]').boundingBox())!
        .height,
    ).toBeGreaterThanOrEqual(62);
    const shellBox = (await page
      .locator('[data-ui="composer-shell"]')
      .boundingBox())!;
    const toolbarBox = (await page
      .locator('[data-ui="composer-toolbar"]')
      .boundingBox())!;
    expect(toolbarBox.y + toolbarBox.height).toBeLessThanOrEqual(
      shellBox.y + shellBox.height,
    );
    const question = page.getByRole("region", { name: "Agent question" });
    const collapse = question.getByRole("button", {
      name: "Collapse question",
    });
    await revealInSurface(page, collapse, height);
    await collapse.click();
    expect(
      (await page.locator('[data-ui="question-dock"]').boundingBox())!.height,
    ).toBeLessThan(180);
    const show = question.getByRole("button", { name: "Show question" });
    await revealInSurface(page, show, height);
    await show.click();
    const list = question.locator(":scope > div > div").first();
    const option = question.getByRole(goal ? "radio" : "checkbox", {
      name: /^Option 3/,
    });
    await option.evaluate((e) => {
      const list = e.closest('[role="radiogroup"], [role="group"]')!
        .parentElement!.parentElement!;
      const r = e.getBoundingClientRect(),
        s = list.getBoundingClientRect();
      list.scrollBy(0, (r.top + r.bottom - s.top - s.bottom) / 2);
    });
    await revealInSurface(page, option, height);
    const r = (await option.boundingBox())!;
    await page.mouse.click(r.x + r.width / 2, r.y + r.height / 2);
    await expect(option).toHaveAttribute("aria-checked", "true");
    const custom = question.getByRole("textbox");
    await list.evaluate((e) => e.scrollTo(0, e.scrollHeight));
    await revealInSurface(page, custom, height);
    await custom.fill("Preserve the task and verify it.");
    const answerSend = question.getByRole("button", {
      name: "Send",
      exact: true,
    });
    await revealInSurface(page, answerSend, height);
    await answerSend.click();
    await expect(page.getByLabel("Fixture submitted response")).toContainText(
      "Preserve the task and verify it.",
    );
    await expect(draft).toHaveValue(content);
    if (goal)
      await revealInSurface(
        page,
        page.getByRole("button", { name: "Pause goal" }),
        height,
      );
    const send = page.getByRole("button", { name: "Send message" });
    await revealInSurface(page, send, height);
    await page.screenshot({
      path: info.outputPath("small-fixed-controls.png"),
    });
    await send.click();
    await expect(page.getByLabel("Fixture submitted response")).toHaveText(
      "Message submitted",
    );
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    expect(errors).toEqual([]);
  });
}

test("normal height keeps transcript scrolling inside its own viewport", async ({
  page,
}, info) => {
  await openShell(page);
  const surface = page.locator("[data-rift-chat-surface]");
  const transcript = page.locator('[data-ui="fixture-transcript"]');
  expect(
    await surface.evaluate((e) => e.scrollHeight - e.clientHeight),
  ).toBeLessThanOrEqual(1);
  const r = (await transcript.boundingBox())!;
  expect(r.height).toBeGreaterThan(0);
  if (info.project.name.startsWith("webkit") && info.project.use.isMobile) {
    await transcript.evaluate((e) => e.scrollBy(0, 80));
  } else {
    await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2);
    await page.mouse.wheel(0, 80);
  }
  await expect
    .poll(() => transcript.evaluate((e) => e.scrollTop))
    .toBeGreaterThan(0);
  expect(await surface.evaluate((e) => e.scrollTop)).toBe(0);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});

test("rejected answer keeps selection and draft available for explicit retry", async ({
  page,
}) => {
  const errors = await openShell(page, "?rejectAnswer=1");
  const draft = page.getByRole("textbox", { name: "Message RIFT" });
  await draft.fill("Keep this unsent draft");
  const question = page.getByRole("region", { name: "Agent question" });
  await question.getByRole("textbox").fill("Use the existing implementation");
  await question.getByRole("button", { name: "Send", exact: true }).click();
  await expect(question.getByRole("alert")).toContainText("not confirmed");
  await expect(question.getByRole("textbox")).toHaveValue(
    "Use the existing implementation",
  );
  await expect(draft).toHaveValue("Keep this unsent draft");
  await expect(question.getByText("Answer sent", { exact: true })).toHaveCount(
    0,
  );
  await question.getByRole("button", { name: "Send", exact: true }).click();
  await expect(
    question.getByText("Answer sent", { exact: true }),
  ).toBeVisible();
  await expect(
    question.getByRole("button", { name: "Sent", exact: true }),
  ).toBeDisabled();
  await expect(draft).toHaveValue("Keep this unsent draft");
  expect(errors).toEqual([]);
});
