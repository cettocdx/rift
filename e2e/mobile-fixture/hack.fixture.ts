import { test, expect } from "@playwright/test";

test("Hack mobile draft, task sidebar and output remain usable", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) =>
    new URL(route.request().url()).origin === "http://127.0.0.1:3062"
      ? route.continue()
      : route.abort(),
  );
  await page.goto("/lab/composer");
  const draft = page.getByRole("textbox", { name: "Security agent command" });
  await expect(draft).toBeVisible();
  await draft.fill("Retain this report review draft");
  const geometry = await draft.evaluate((node) => {
    const r = node.getBoundingClientRect();
    return {
      left: r.left,
      right: r.right,
      bottom: r.bottom,
      width: innerWidth,
      height: innerHeight,
      font: parseFloat(getComputedStyle(node).fontSize),
    };
  });
  expect(geometry.left).toBeGreaterThanOrEqual(0);
  expect(geometry.right).toBeLessThanOrEqual(geometry.width);
  expect(geometry.bottom).toBeLessThanOrEqual(geometry.height);
  expect(geometry.font).toBeGreaterThanOrEqual(16);
  await page.evaluate(() => {
    Object.defineProperty(visualViewport!, "height", {
      configurable: true,
      get: () => 377,
    });
    visualViewport!.dispatchEvent(new Event("resize"));
  });
  await expect(page.locator(".overview-panel")).toBeHidden();
  await expect(page.locator(".mobile-ops")).toBeHidden();
  await expect
    .poll(async () => (await page.locator(".out").boundingBox())?.height ?? 0)
    .toBeGreaterThan(80);
  await page.getByRole("button", { name: "Show security tasks" }).tap();
  const tasks = page.getByRole("dialog", { name: "Security tasks" });
  await expect(tasks).toBeVisible();
  await expect(
    tasks.getByRole("searchbox", { name: "Filter security tasks" }),
  ).toBeVisible();
  await tasks.getByRole("button", { name: "Close security tasks" }).tap();
  await expect(tasks).toBeHidden();
  await expect(page.locator(".overview-panel")).toBeVisible();
  await expect(draft).toHaveValue("Retain this report review draft");
  const output = page.locator("#rift-console");
  await expect(output).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});
