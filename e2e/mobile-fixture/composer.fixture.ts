import { expect, test, type Locator } from "@playwright/test";

async function geometry(locator: Locator) {
  await expect(locator).toBeVisible();
  return locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const view = window.visualViewport!;
    const inset = Math.min(rect.width, rect.height) * 0.25;
    const points = [
      [rect.left + inset, rect.top + inset],
      [rect.right - inset, rect.top + inset],
      [rect.left + inset, rect.bottom - inset],
      [rect.right - inset, rect.bottom - inset],
      [rect.left + rect.width / 2, rect.top + rect.height / 2],
    ];
    return {
      x: rect.x,
      y: rect.y,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
      withinViewport:
        rect.left >= view.offsetLeft &&
        rect.right <= view.offsetLeft + view.width + 1 &&
        rect.top >= view.offsetTop &&
        rect.bottom <= view.offsetTop + view.height + 1,
      hit: points.every(([x, y]) =>
        element.contains(document.elementFromPoint(x, y)),
      ),
    };
  });
}

test("production composer keeps model readable and send aligned; menus preserve draft", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => {
    if (new URL(route.request().url()).origin !== "http://127.0.0.1:3038") {
      errors.push("Unexpected external request");
      return route.abort();
    }
    return route.continue();
  });
  await page.goto("/lab/composer");
  const draft = page.getByRole("textbox", { name: "Message RIFT" });
  await draft.fill(
    "Retain this draft while I choose the model and reasoning effort.",
  );
  const toolbar = page.locator('[data-ui="composer-toolbar"]');
  const send = page.getByRole("button", { name: "Send message" });
  const attach = page.getByRole("button", { name: "Attach files" });
  const model = page.locator('[data-ui="model-selector-trigger"]');
  await expect(
    page.locator('[data-ui="reasoning-effort-trigger"]'),
  ).toHaveCount(0);
  await expect(send).toBeEnabled();
  const coarse = await page.evaluate(
    () => matchMedia("(pointer: coarse)").matches,
  );
  expect(coarse).toBe(Boolean(info.project.use.hasTouch));
  const mobile = page.viewportSize()!.width < 768;
  const measured = {
    send: await geometry(send),
    attach: await geometry(attach),
    model: await geometry(model),
    toolbar: await toolbar.boundingBox(),
  };
  await info.attach("composer-geometry", {
    body: JSON.stringify(measured, null, 2),
    contentType: "application/json",
  });
  for (const [name, rect] of Object.entries(measured).filter(
    ([name]) => name !== "toolbar",
  ) as [string, Awaited<ReturnType<typeof geometry>>][]) {
    expect(rect.withinViewport, `${name} clipped by viewport`).toBe(true);
    expect(rect.hit, `${name} clipped or overlaid`).toBe(true);
    if (coarse) {
      expect(rect.width, `${name} touch width`).toBeGreaterThanOrEqual(44);
      expect(rect.height, `${name} touch height`).toBeGreaterThanOrEqual(44);
    }
  }
  expect(
    Math.abs(measured.send.y - measured.attach.y),
    "send and attachment must share bottom row",
  ).toBeLessThanOrEqual(2);
  const paddingRight = await toolbar.evaluate((el) =>
    parseFloat(getComputedStyle(el).paddingRight),
  );
  expect(
    Math.abs(
      measured.send.right -
        (measured.toolbar!.x + measured.toolbar!.width - paddingRight),
    ),
    "send must align to toolbar right padding",
  ).toBeLessThanOrEqual(2);
  const centers = [measured.send, measured.attach, measured.model].map(
    (rect) => rect.y + rect.height / 2,
  );
  expect(
    Math.max(...centers) - Math.min(...centers),
    "attachment, model and send must share one row",
  ).toBeLessThanOrEqual(2);
  const label = page.locator('[data-ui="model-selector-label"]');
  await expect(label).toBeVisible();
  expect(
    await label.evaluate((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      return (
        range.getBoundingClientRect().width <=
          el.getBoundingClientRect().width + 1 &&
        el.scrollWidth <= el.clientWidth + 1
      );
    }),
    "model name must not be truncated at these widths",
  ).toBe(true);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    "page overflow",
  ).toBe(true);
  await info.attach("composer-layout", {
    body: await page.screenshot(),
    contentType: "image/png",
  });

  await page.setViewportSize({
    width: page.viewportSize()!.width,
    height: 480,
  });
  for (let repeat = 0; repeat < 2; repeat++) {
    // Exercise both production theme token sets in the same retained draft.
    await page.evaluate((dark) => {
      document.documentElement.classList.toggle("dark", dark);
      document.documentElement.style.colorScheme = dark ? "dark" : "light";
    }, repeat === 1);
    const beforeMenu = await model.boundingBox();
    const beforeScroll = await page.evaluate(() => window.scrollY);
    await model.click();
    const menu = page.locator('[data-ui="model-selector-menu"]');
    await expect(menu).toBeVisible();
    expect((await geometry(menu)).withinViewport).toBe(true);
    const modelRow = menu.getByRole("button", { name: /^Model:/ });
    await expect(modelRow).toBeFocused();
    for (const row of [
      modelRow,
      menu.getByRole("button", { name: /^Effort:/ }),
    ]) {
      const rect = await geometry(row);
      expect(rect.hit).toBe(true);
      if (coarse)
        await expect
          .poll(async () => (await geometry(row)).height)
          .toBeGreaterThanOrEqual(44);
    }
    if (info.project.name === "webkit-390-coarse") {
      await info.attach(`parameters-${repeat === 1 ? "dark" : "light"}`, {
        body: await page.screenshot(),
        contentType: "image/png",
      });
    }
    await modelRow.click();
    const selectedModel = menu.getByRole("radio", { checked: true });
    await expect(selectedModel).toBeFocused();
    if (coarse)
      await expect
        .poll(async () => (await geometry(selectedModel)).height)
        .toBeGreaterThanOrEqual(44);
    const radios = menu.getByRole("radio");
    const originalIndex = await radios.evaluateAll((options) =>
      options.findIndex(
        (option) => option.getAttribute("aria-checked") === "true",
      ),
    );
    await selectedModel.press("End");
    const lastModel = radios.last();
    await expect(lastModel).toHaveAttribute("aria-checked", "true");
    await expect(lastModel).toBeFocused();
    expect(
      (await geometry(lastModel)).hit,
      "keyboard selection must immediately clear the scrollbar rail",
    ).toBe(true);
    expect(
      await lastModel.evaluate((element) => {
        const panel = element.closest<HTMLElement>(
          '[data-ui="model-selector-menu"]',
        )!;
        const rect = element.getBoundingClientRect();
        const top = panel.getBoundingClientRect().top + panel.clientTop;
        return rect.top >= top && rect.bottom <= top + panel.clientHeight;
      }),
      "selected model must remain inside the panel scrollport",
    ).toBe(true);
    await lastModel.press("Home");
    for (let index = 0; index < originalIndex; index++)
      await page.keyboard.press("ArrowDown");
    expect(await page.evaluate(() => window.scrollY)).toBe(beforeScroll);
    await page.keyboard.press("Escape");
    await expect(modelRow).toBeFocused();
    await menu.getByRole("button", { name: /^Effort:/ }).click();
    const panel = page.locator('[data-ui="reasoning-effort-panel"]');
    await expect(panel).toBeVisible();
    await expect(page.locator('[data-slot="popover-content"]')).toHaveCount(1);
    await expect(model).toBeVisible();
    expect(await model.boundingBox()).toEqual(beforeMenu);
    expect(await page.evaluate(() => window.scrollY)).toBe(beforeScroll);
    expect((await geometry(menu)).withinViewport).toBe(true);
    if (info.project.name === "webkit-390-coarse") {
      await info.attach(`effort-${repeat === 1 ? "dark" : "light"}`, {
        body: await page.screenshot(),
        contentType: "image/png",
      });
    }
    await page
      .getByRole("slider", { name: "Reasoning effort" })
      .press("ArrowRight");
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    await expect(menu.getByRole("button", { name: /^Effort:/ })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(model).toBeFocused();
    await expect(draft).toHaveValue(
      "Retain this draft while I choose the model and reasoning effort.",
    );
    await expect(send).toBeEnabled();
    expect((await geometry(model)).hit).toBe(true);
  }
  expect(errors).toEqual([]);
});

for (const goal of [false, true]) {
  for (const streaming of [false, true]) {
    test(`long draft keeps ${streaming ? "stop" : "send"} reachable, goal=${goal}`, async ({
      page,
    }, info) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route("**/*", (route) => {
        if (new URL(route.request().url()).origin !== "http://127.0.0.1:3038") {
          errors.push("Unexpected external request");
          return route.abort();
        }
        return route.continue();
      });
      await page.setViewportSize({
        width: page.viewportSize()!.width,
        height: 480,
      });
      await page.goto(
        `/lab/composer?compact=1${goal ? "&goal=1" : ""}${streaming ? "&streaming=1" : ""}`,
      );
      const draft = page.getByRole("textbox", { name: "Message RIFT" });
      const text = Array.from(
        { length: 24 },
        (_, i) =>
          `Line ${i + 1}: Keep this complete long draft while building.`,
      ).join("\n");
      await draft.fill(text);
      const action = page.getByRole("button", {
        name: streaming ? "Stop generation" : "Send message",
        exact: true,
      });
      const rect = await geometry(action);
      const inputRect = await draft.boundingBox();
      const toolbarRect = await page
        .locator('[data-ui="composer-toolbar"]')
        .boundingBox();
      await info.attach("long-draft-geometry", {
        body: JSON.stringify({ rect, inputRect, toolbarRect }),
        contentType: "application/json",
      });
      expect(rect.withinViewport).toBe(true);
      expect(
        inputRect!.height,
        "long draft must still expand before scrolling",
      ).toBeGreaterThan(90);
      expect(rect.hit, "Send/Stop clipped by capped composer").toBe(true);
      expect(
        inputRect!.y + inputRect!.height,
        "draft must not overlap toolbar",
      ).toBeLessThanOrEqual(toolbarRect!.y + 1);
      expect(
        await draft.evaluate((el) => el.scrollHeight > el.clientHeight),
      ).toBe(true);
      await expect(draft).toHaveValue(text);
      await draft.evaluate((el) => {
        el.scrollTop = el.scrollHeight;
      });
      await expect
        .poll(() => draft.evaluate((el) => el.scrollTop))
        .toBeGreaterThan(0);
      if (info.project.name === "webkit-390-coarse" && goal && !streaming) {
        await info.attach("long-draft-visible-controls", {
          body: await page.screenshot(),
          contentType: "image/png",
        });
      }
      await action.click();
      await expect(page.getByLabel("Fixture action")).toHaveText(
        streaming ? "stopped" : "submitted",
      );
      expect(errors).toEqual([]);
    });
  }
}

test("mobile settings keep advanced controls off the conversation and preserve the draft", async ({
  page,
}, info) => {
  test.skip(info.project.use.viewport!.width >= 768, "Mobile settings only");
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/lab/composer");
  const draft = page.getByRole("textbox", { name: "Message RIFT" });
  await draft.fill("Keep my draft while changing how RIFT works.");
  await expect(page.getByRole("button", { name: /^Chat mode:/ })).toHaveCount(
    0,
  );
  const settings = page.getByRole("button", {
    name: "Chat settings",
    exact: true,
  });
  await page.screenshot({ path: info.outputPath("mobile-composer.png") });
  await settings.click();
  const panel = page.getByRole("dialog", {
    name: "Chat settings",
    exact: true,
  });
  await expect(panel).toBeVisible();
  const panelGeometry = await geometry(panel);
  expect(
    panelGeometry.withinViewport,
    "settings sheet must not inherit dialog centering",
  ).toBe(true);
  expect(panelGeometry.x).toBeGreaterThanOrEqual(0);
  expect(
    Math.abs(panelGeometry.bottom - page.viewportSize()!.height),
  ).toBeLessThanOrEqual(1);
  await page.screenshot({ path: info.outputPath("mobile-settings.png") });
  await panel.getByRole("button", { name: /^Chat mode:/ }).click();
  await page.getByRole("menuitem", { name: /Plan/ }).click();
  await expect(panel.getByRole("button", { name: /^Chat mode:/ })).toHaveText(
    /Plan/,
  );
  await panel.getByRole("button", { name: /^Permissions:/ }).click();
  await page.getByRole("radio", { name: /Allow edits/ }).click();
  await page.keyboard.press("Escape");
  await expect(panel).toBeVisible();
  await panel.getByRole("button", { name: "Close chat settings" }).click();
  await expect(panel).not.toBeVisible();
  await expect(draft).toHaveValue(
    "Keep my draft while changing how RIFT works.",
  );
  await expect(settings).toBeFocused();
  await settings.click();
  await expect(
    panel.getByRole("button", { name: /^Permissions:/ }),
  ).toHaveAttribute("aria-label", "Permissions: Allow edits");
  await panel.getByRole("button", { name: "Execution target: Cloud" }).click();
  await expect(page.getByRole("menuitem", { name: /^Cloud/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await panel.getByRole("button", { name: "Select project context" }).click();
  await expect(
    page.getByRole("menuitemradio", { name: /No project/ }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 900, height: 844 });
  await expect(panel).not.toBeVisible();
  await expect(page.getByRole("button", { name: /^Chat mode:/ })).toHaveText(
    /Plan/,
  );
  await expect(draft).toHaveValue(
    "Keep my draft while changing how RIFT works.",
  );
  expect(errors).toEqual([]);
});

test("Return adds a line on phones and submits on desktop", async ({
  page,
}, info) => {
  await page.goto("/lab/composer");
  const draft = page.getByRole("textbox", { name: "Message RIFT" });
  await draft.fill("First line");
  await draft.press("End");
  await draft.press("Enter");
  if (info.project.use.viewport!.width < 768) {
    await expect(draft).toHaveValue("First line\n");
    await expect(page.getByLabel("Fixture action")).toHaveText("");
    await page.getByRole("button", { name: "Send message" }).click();
  }
  await expect(page.getByLabel("Fixture action")).toHaveText("submitted");
});
