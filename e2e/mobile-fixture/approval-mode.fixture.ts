import { expect, test } from "@playwright/test";

test("permissions keyboard navigation starts at the selected mode and preserves the draft", async ({
  page,
}, info) => {
  await page.addInitScript(() =>
    localStorage.setItem("rift:approval-mode", "full"),
  );
  await page.goto("/lab/composer");
  const draft = page.getByRole("textbox", { name: "Message RIFT" });
  await draft.fill("Keep this draft while changing permissions.");
  const mobile = !info.project.name.includes("desktop");
  if (mobile)
    await page
      .getByRole("button", { name: "Chat settings", exact: true })
      .click();
  const trigger = page.getByRole("button", {
    name: "Permissions: Run freely",
    exact: true,
  });
  await trigger.click();
  const menu = page.locator('[data-rift-composer-menu="approval"]');
  const freely = menu.getByRole("radio", { name: /^Run freely/ });
  const review = menu.getByRole("radio", { name: /^Review first/ });
  const edits = menu.getByRole("radio", { name: /^Allow edits/ });
  await expect(freely).toBeFocused();
  await freely.press("ArrowUp");
  await expect(edits).toBeFocused();
  await expect(edits).toHaveAttribute("aria-checked", "true");
  await edits.press("Home");
  await expect(review).toBeFocused();
  await expect(review).toHaveAttribute("aria-checked", "true");
  await review.press("ArrowUp");
  await expect(freely).toBeFocused();
  await expect(freely).toHaveAttribute("aria-checked", "true");
  await freely.press("ArrowDown");
  await expect(review).toBeFocused();
  await expect(review).toHaveAttribute("aria-checked", "true");
  await review.press("End");
  await expect(freely).toBeFocused();
  await expect(freely).toHaveAttribute("aria-checked", "true");
  await expect(menu.locator('[role="radio"][tabindex="0"]')).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await expect(freely).toBeFocused();
  await page.keyboard.press("Escape");
  if (mobile)
    await page.getByRole("button", { name: "Close chat settings" }).click();
  await expect(draft).toHaveValue(
    "Keep this draft while changing permissions.",
  );
  expect(
    await page.evaluate(() => localStorage.getItem("rift:approval-mode")),
  ).toBe("full");
});

for (const theme of ["light", "dark"]) {
  test(`actual permissions selector keeps selection and bounds in ${theme}`, async ({
    page,
  }, info) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/*", (route) =>
      new URL(route.request().url()).origin === "http://127.0.0.1:3059"
        ? route.continue()
        : route.abort(),
    );
    await page.addInitScript(() =>
      localStorage.setItem("rift:approval-mode", "full"),
    );
    await page.goto("/lab/composer");
    await page.evaluate((dark) => {
      document.documentElement.classList.toggle("dark", dark);
      document.documentElement.classList.toggle("light", !dark);
      document.documentElement.style.colorScheme = dark ? "dark" : "light";
    }, theme === "dark");
    const mobile = !info.project.name.includes("desktop");
    if (mobile)
      await page
        .getByRole("button", { name: "Chat settings", exact: true })
        .click();
    const trigger = page.getByRole("button", {
      name: "Permissions: Run freely",
      exact: true,
    });
    await expect(trigger).toBeVisible();
    await expect(trigger.locator("svg.lucide-shield-check")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const label = trigger.locator('[data-ui="approval-mode-label"]');
    await expect(label).toBeVisible();
    await page.screenshot({ path: info.outputPath(`${theme}-trigger.png`) });
    await trigger.click();
    const menu = page.locator('[data-rift-composer-menu="approval"]');
    await expect(menu).toBeVisible();
    await expect(
      menu.getByRole("radio", { name: /^Run freely/ }),
    ).toHaveAttribute("aria-checked", "true");
    const box = await menu.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(
      page.viewportSize()!.height,
    );
    await page.screenshot({
      path: info.outputPath(`${theme}-permissions.png`),
      animations: "disabled",
    });
    for (const [name, value] of [
      ["Review first", "ask"],
      ["Allow edits", "auto"],
      ["Run freely", "full"],
    ]) {
      await menu.getByRole("radio", { name: new RegExp(`^${name}`) }).click();
      await expect(
        menu.getByRole("radio", { name: new RegExp(`^${name}`) }),
      ).toHaveAttribute("aria-checked", "true");
      await expect(
        menu.locator('[role="radio"][aria-checked="true"]'),
      ).toHaveCount(1);
      expect(
        await page.evaluate(() => localStorage.getItem("rift:approval-mode")),
      ).toBe(value);
      await expect(
        page.getByRole("button", { name: `Permissions: ${name}`, exact: true }),
      ).toBeVisible();
    }
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();
    expect(errors).toEqual([]);
  });
}

test("nested permissions stay scrollable in a short mobile viewport", async ({
  page,
}, info) => {
  test.skip(info.project.name.includes("desktop"), "Phone viewport contract");
  await page.setViewportSize({ width: 360, height: 280 });
  await page.goto("/lab/composer?compact=1");
  const draft = page.getByRole("textbox", { name: "Message RIFT" });
  await draft.fill("Retain this draft in the short viewport.");
  await page
    .getByRole("button", { name: "Chat settings", exact: true })
    .click();
  await page.getByRole("button", { name: /^Permissions:/ }).click();
  const menu = page.locator('[data-rift-composer-menu="approval"]');
  await expect(menu).toBeVisible();
  await expect
    .poll(async () => {
      const rect = await menu.boundingBox();
      return rect!.y >= 0 && rect!.y + rect!.height <= 280;
    })
    .toBe(true);
  for (const label of ["Review first", "Allow edits", "Run freely"]) {
    const option = menu.getByRole("radio", { name: new RegExp(`^${label}`) });
    await option.scrollIntoViewIfNeeded();
    expect(
      await option.evaluate((el) => {
        const rect = el.getBoundingClientRect();
        return el.contains(
          document.elementFromPoint(
            rect.x + rect.width / 2,
            rect.y + rect.height / 2,
          ),
        );
      }),
    ).toBe(true);
    await option.click();
    await expect(option).toHaveAttribute("aria-checked", "true");
  }
  await page.screenshot({ path: info.outputPath("short-permissions.png") });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Close chat settings" }).click();
  await expect(draft).toHaveValue("Retain this draft in the short viewport.");
});
