import { expect, test } from "@playwright/test";

test("installed plugin targets fit touch pointers without enlarging desktop cards", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => {
    if (
      new URL(route.request().url()).origin !== "http://127.0.0.1:3039" ||
      !["GET", "HEAD"].includes(route.request().method())
    ) {
      errors.push("Unexpected request outside read-only fixture");
      return route.abort();
    }
    return route.continue();
  });
  await page.goto("/lab/plugins");
  await expect(
    page.getByRole("heading", { name: "Plugins", exact: true }),
  ).toBeVisible();
  const coarse = await page.evaluate(
    () => matchMedia("(pointer: coarse)").matches,
  );
  expect(coarse).toBe(Boolean(info.project.use.hasTouch));
  const measurements: Record<string, unknown> = {};
  for (const name of [
    "Connected fixture",
    "Disabled fixture",
    "Attention fixture",
  ]) {
    const identity = page.getByRole("button", { name, exact: true });
    const row = page.locator("article").filter({ has: identity });
    await row.scrollIntoViewIfNeeded();
    const buttons = row.getByRole("button");
    for (const button of await buttons.all()) {
      const box = await button.boundingBox();
      const label =
        (await button.getAttribute("aria-label")) || (await button.innerText());
      measurements[`${name}: ${label}`] = box;
      expect(box).not.toBeNull();
      if (coarse) {
        expect
          .soft(box!.height, `${label} coarse target height`)
          .toBeGreaterThanOrEqual(44);
        expect
          .soft(box!.width, `${label} coarse target width`)
          .toBeGreaterThanOrEqual(44);
      }
      expect(
        await button.evaluate((el) => {
          const r = el.getBoundingClientRect();
          return (
            r.left >= 0 &&
            r.right <= innerWidth &&
            [0.25, 0.5, 0.75].every((f) =>
              el.contains(
                document.elementFromPoint(
                  r.left + r.width * f,
                  r.top + r.height / 2,
                ),
              ),
            )
          );
        }),
        `${label} must be unclipped and hit-testable`,
      ).toBe(true);
    }
    measurements[`${name}: row`] = await row.boundingBox();
    // Preserve the existing compact row: no new card borders or extra action row.
    expect((await row.boundingBox())!.height).toBeLessThanOrEqual(100);
    const more = page.getByRole("button", { name: `More actions for ${name}` });
    if (!coarse) {
      expect((await more.boundingBox())!.height).toBe(32);
      const action = row.getByRole("button", { name: /^(Connect|Reconnect)$/ });
      if (await action.count())
        expect((await action.boundingBox())!.height).toBe(30);
    }
    await more.click();
    await expect(page.getByRole("menu")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toBeHidden();
  }
  const categories = page.getByRole("group", { name: "Plugin categories" });
  expect(
    await categories.evaluate((el) => getComputedStyle(el).overflowX),
  ).toBe("auto");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await info.attach("plugin-targets", {
    body: JSON.stringify(measurements, null, 2),
    contentType: "application/json",
  });
  await info.attach("plugins", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
  expect(errors).toEqual([]);
});
