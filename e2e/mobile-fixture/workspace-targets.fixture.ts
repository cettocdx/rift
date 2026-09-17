import { expect, test, type Locator } from "@playwright/test";
import { inspectControl } from "../mobile-acceptance/geometry";
import { isKnownBrowserDiagnostic } from "../mobile-acceptance/browser-diagnostics";

test("agent profile fits a reduced visible viewport and preserves its draft", async ({
  page,
}, info) => {
  test.skip(!info.project.use.hasTouch, "Mobile visual viewport contract");
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => {
    const viewport = new EventTarget();
    const values = { height: innerHeight, offsetTop: 0, scale: 1 };
    for (const key of Object.keys(values))
      Object.defineProperty(viewport, key, {
        get: () => values[key as keyof typeof values],
      });
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: viewport,
    });
    Reflect.set(
      window,
      "agentFixtureViewport",
      (next: Partial<typeof values>) => {
        Object.assign(values, next);
        viewport.dispatchEvent(new Event("resize"));
      },
    );
  });
  await page.goto("/lab/workspace-targets?section=agent-profile&theme=dark");
  await page.evaluate(() =>
    Reflect.get(window, "agentFixtureViewport")({ height: 400, offsetTop: 40 }),
  );
  const opener = page.getByRole("button", { name: "Configure fixture agent" });
  await opener.click();
  const dialog = page.getByRole("dialog", {
    name: "Create agent",
    exact: true,
  });
  await expect(dialog).toHaveCSS("opacity", "1");
  const name = dialog.getByRole("textbox", { name: "Agent name", exact: true });
  await expect.soft(name).toHaveCSS("font-size", "16px");
  const fits = async () => {
    await expect
      .poll(() =>
        dialog.evaluate((el) => {
          const r = el.getBoundingClientRect(),
            v = window.visualViewport!;
          return (
            r.top >= v.offsetTop - 1 && r.bottom <= v.offsetTop + v.height + 1
          );
        }),
      )
      .toBe(true);
  };
  await fits();
  await name.fill("Mobile draft");
  await expect(name).toHaveCSS("font-size", "16px");
  await page.evaluate(() =>
    Reflect.get(window, "agentFixtureViewport")({ height: 300, offsetTop: 60 }),
  );
  await fits();
  await name.scrollIntoViewIfNeeded();
  await expect
    .poll(() =>
      name.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return (
          document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) ===
          el
        );
      }),
    )
    .toBe(true);
  await dialog.getByRole("button", { name: "Next", exact: true }).click();
  await dialog.getByRole("button", { name: "Back", exact: true }).click();
  await expect(name).toHaveValue("Mobile draft");
  await page.screenshot({
    path: info.outputPath("agent-visible-viewport.png"),
  });
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("agent profile review shows usable mentions and model names", async ({
  page,
}) => {
  await page.goto("/lab/workspace-targets?section=agent-profile&theme=light");
  await page.getByRole("button", { name: "Configure fixture agent" }).click();
  const dialog = page.getByRole("dialog", {
    name: "Create agent",
    exact: true,
  });
  const step = async (value: string, label: RegExp) => {
    const mobile = dialog.getByRole("combobox", {
      name: "Agent configuration section",
      exact: true,
    });
    if (await mobile.isVisible()) await mobile.selectOption(value);
    else await dialog.getByRole("button", { name: label }).click();
  };
  await step("review", /Review & test/);
  await expect(
    dialog.locator("dl").getByText("@agent:buddy", { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.locator("dl").getByText("Workspace default", { exact: true }),
  ).toBeVisible();
  await step("runtime", /Runtime/);
  await dialog
    .getByRole("combobox", { name: "Model", exact: true })
    .selectOption("build-codex");
  await step("review", /Review & test/);
  await expect(
    dialog.locator("dl").getByText("GPT-5.6 Sol", { exact: true }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toHaveCount(0);
});

for (const theme of ["light", "dark"])
  for (const section of ["runs", "tasks", "agents", "appearance"])
    test(`${section} ${theme}: reachable targets and unchanged fine-pointer density`, async ({
      page,
      context,
      browserName,
    }, info) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        if (
          message.type() === "error" &&
          !isKnownBrowserDiagnostic(browserName, message.text())
        )
          errors.push(message.text());
      });
      await context.route("**/*", async (route) => {
        const req = route.request();
        if (
          new URL(req.url()).origin !== "http://127.0.0.1:3042" ||
          !["GET", "HEAD"].includes(req.method())
        ) {
          errors.push("External or mutating request blocked");
          await route.abort();
        } else await route.continue();
      });
      await page.goto(
        `/lab/workspace-targets?section=${section}&theme=${theme}`,
      );
      await expect(page.locator("html")).toHaveClass(new RegExp(theme));
      const coarse = await page.evaluate(
        () => matchMedia("(pointer: coarse)").matches,
      );
      expect(coarse).toBe(info.project.use.hasTouch === true);
      const measurements: unknown[] = [];
      const check = async (
        control: Locator,
        name: string,
        fineHeight?: number,
      ) => {
        await expect(control).toBeVisible();
        await control.evaluate(async (el) => {
          for (
            let parent: Element | null = el;
            parent;
            parent = parent.parentElement
          ) {
            await Promise.all(
              parent
                .getAnimations()
                .filter((a) => a.effect?.getTiming().iterations !== Infinity)
                .map((a) => a.finished.catch(() => {})),
            );
          }
        });
        const measured = await inspectControl(control, name, true);
        measurements.push(measured);
        if (coarse) {
          expect
            .soft(measured.rect.width, name + " touch width")
            .toBeGreaterThanOrEqual(44);
          expect
            .soft(measured.rect.height, name + " touch height")
            .toBeGreaterThanOrEqual(44);
        } else if (fineHeight !== undefined) {
          expect
            .soft(
              Math.abs(measured.rect.height - fineHeight),
              name + " preserves fine height",
            )
            .toBeLessThanOrEqual(2);
        }
      };
      if (section === "runs") {
        const filters = page
          .getByRole("group", { name: "Filter runs by status" })
          .getByRole("button");
        for (const control of await filters.all())
          await check(control, await control.innerText(), 28);
        const completed = filters.filter({ hasText: "Completed" });
        await completed.click();
        await expect(completed).toHaveAttribute("aria-pressed", "true");
        await expect(
          page.getByText("Fixture completed run", { exact: true }),
        ).toBeVisible();
      } else if (section === "tasks") {
        await check(
          page.getByRole("button", { name: "Create task", exact: true }),
          "Create task",
          32,
        );
        for (const control of await page
          .getByRole("group", { name: "Filter tasks", exact: true })
          .getByRole("button")
          .all())
          await check(control, await control.innerText(), 30);
        const taskFilter = page
          .getByRole("group", { name: "Filter tasks", exact: true })
          .getByRole("button")
          .filter({ hasText: "Scheduled" });
        await taskFilter.click();
        await expect(taskFilter).toHaveAttribute("aria-pressed", "true");
        await page
          .getByRole("button", { name: "Create task", exact: true })
          .click();
        const dialog = page.getByRole("dialog");
        await expect(dialog).toBeVisible();
        for (const control of await dialog
          .locator("button,input,textarea")
          .all())
          await check(control, "Task dialog control");
        await dialog
          .getByLabel("Name", { exact: true })
          .fill("Fixture draft remains local");
        await expect(dialog.getByLabel("Name", { exact: true })).toHaveValue(
          "Fixture draft remains local",
        );
        await page.keyboard.press("Escape");
        await expect(dialog).toBeHidden();
      } else if (section === "agents") {
        await check(
          page.getByRole("combobox", { name: "Project", exact: true }),
          "Project selector",
          browserName === "webkit" ? 19 : 25.5,
        );
        const create = page.getByRole("button", {
          name: "Create project",
          exact: true,
        });
        await check(create, "Create project icon", 28);
        await check(
          page.getByRole("button", { name: "Add bot", exact: true }),
          "Add bot",
          35.5,
        );
        await create.click();
        const dialog = page.getByRole("dialog");
        await expect(dialog).toBeVisible();
        for (const control of await dialog.locator("button,input").all())
          await check(control, "Project dialog control");
        await page.keyboard.press("Escape");
        await expect(dialog).toBeHidden();
        await page
          .getByRole("button", { name: "Add bot", exact: true })
          .click();
        await expect(dialog).toBeVisible();
        for (const control of await dialog.locator("button,input").all())
          await check(control, "Bot catalog control");
        await page.keyboard.press("Escape");
        await expect(dialog).toBeHidden();
      } else {
        const ranges = page.locator('input[type="range"]');
        await expect(ranges).toHaveCount(2);
        for (const control of await ranges.all()) {
          await check(control, "Appearance slider", 16);
        }
        await page
          .locator("summary")
          .filter({ hasText: "Customize theme colors" })
          .click();
        const colors = page.locator('input[type="color"]');
        await expect(colors).toHaveCount(6);
        for (const control of await colors.all()) {
          if (coarse) await check(control, "Color input");
          else {
            const frame = await control.evaluate(
              (el) => el.parentElement!.getBoundingClientRect().height,
            );
            expect(frame, "fine swatch frame preserved").toBe(20);
          }
        }
        const color = colors.first();
        await color.fill("#336699");
        await expect(color).toHaveValue("#336699");
        const range = ranges.first();
        if (coarse) {
          // Native range padding must respond to touch, not merely win hit tests.
          for (const slider of await ranges.all()) {
            await slider.scrollIntoViewIfNeeded();
            let box = (await slider.boundingBox())!;
            await page.touchscreen.tap(box.x + box.width * 0.25, box.y + 3);
            const low = Number(await slider.inputValue());
            box = (await slider.boundingBox())!;
            await page.touchscreen.tap(
              box.x + box.width * 0.75,
              box.y + box.height - 3,
            );
            expect(
              Number(await slider.inputValue()),
              "bottom padding changes native range value",
            ).toBeGreaterThan(low);
            box = (await slider.boundingBox())!;
            await page.touchscreen.tap(box.x + box.width * 0.25, box.y + 3);
            expect(
              Number(await slider.inputValue()),
              "top padding changes native range value",
            ).toBe(low);
          }
        }
        const before = Number(await range.inputValue());
        await range.focus();
        await page.keyboard.press("ArrowRight");
        await expect(range).toHaveValue(String(before + 1));
      }
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(page.viewportSize()!.width);
      expect(errors).toEqual([]);
      expect(
        await page.evaluate(() => window.__workspaceFixtureWriteAttempts),
        "no fixture mutation or action attempts",
      ).toBe(0);
      await info.attach("geometry.json", {
        body: JSON.stringify(measurements, null, 2),
        contentType: "application/json",
      });
      await info.attach("viewport", {
        body: await page.screenshot(),
        contentType: "image/png",
      });
    });

test("artifact preview restores the source card and subsequent tab order", async ({
  page,
  browserName,
}) => {
  await page.goto("/lab/workspace-targets?section=artifacts");
  const cards = page.getByRole("button", {
    name: "Open generated image artifact",
    exact: true,
  });
  for (const dismiss of ["Escape", "Close"]) {
    await cards.nth(1).focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Image preview" });
    await expect(dialog).toBeVisible();
    if (dismiss === "Escape") await page.keyboard.press("Escape");
    else
      await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(cards.nth(1)).toBeFocused();
    // WebKit uses Option-Tab for all controls with its default keyboard preference.
    await page.keyboard.press(browserName === "webkit" ? "Alt+Tab" : "Tab");
    await expect(cards.nth(2)).toBeFocused();
  }
});

test("task editor restores create and row action focus", async ({ page }) => {
  await page.goto("/lab/workspace-targets?section=tasks&taskRows=1");
  const create = page.getByRole("button", { name: "Create task", exact: true });
  for (const dismiss of ["Escape", "Cancel"]) {
    await create.click();
    const dialog = page.getByRole("dialog", {
      name: "Create task",
      exact: true,
    });
    if (dismiss === "Escape") await page.keyboard.press("Escape");
    else
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(create).toBeFocused();
  }
  const actions = page.getByRole("button", {
    name: "More actions for Review dependencies",
  });
  await actions.click();
  await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Edit task", exact: true });
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(actions).toBeFocused();
});

test("artifact and task dialogs keep actions reachable in a short viewport", async ({
  page,
}, info) => {
  test.skip(!info.project.use.hasTouch, "Mobile short viewport");
  await page.setViewportSize({ width: 360, height: 320 });
  await page.goto("/lab/workspace-targets?section=artifacts");
  await page
    .getByRole("button", { name: "Open generated image artifact", exact: true })
    .first()
    .click();
  let dialog = page.getByRole("dialog", { name: "Image preview" });
  const close = dialog.getByRole("button", { name: "Close", exact: true });
  const box = await close.boundingBox();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(320);
  await close.click();
  await page.goto("/lab/workspace-targets?section=tasks&taskRows=1");
  await page.getByRole("button", { name: "Create task", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Create task", exact: true });
  await dialog
    .getByRole("textbox", { name: "Name", exact: true })
    .fill("Short viewport task");
  await dialog
    .getByRole("textbox", { name: "Instructions", exact: true })
    .fill("Keep these instructions.");
  const cancel = dialog.getByRole("button", { name: "Cancel", exact: true });
  await cancel.scrollIntoViewIfNeeded();
  const rect = await cancel.boundingBox();
  expect(rect!.y).toBeGreaterThanOrEqual(0);
  expect(rect!.y + rect!.height).toBeLessThanOrEqual(320);
  await cancel.click();
  await expect(dialog).toBeHidden();
  expect(
    await page.evaluate(() => window.__workspaceFixtureWriteAttempts),
  ).toBe(0);
});
