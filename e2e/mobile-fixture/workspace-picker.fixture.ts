import { test, expect } from "@playwright/test";

test("workspace picker finds tools and existing tabs without resetting the panel", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/lab/composer?workbench=1");
  await page
    .getByRole("button", { name: "Open Activity", exact: true })
    .click();
  const trigger = page.getByRole("button", { name: "Add workspace tab" });
  await trigger.click();
  const search = page.getByRole("combobox", {
    name: "Find workspace tab or tool",
  });
  await expect(search).toBeFocused();
  await search.fill("Changes");
  await search.press("Enter");
  await expect(
    page.getByRole("region", { name: "Review changes" }),
  ).toBeVisible();
  await trigger.click();
  await search.fill("Activity");
  await page
    .getByRole("group", { name: "Open tabs" })
    .getByRole("option", { name: "Activity", exact: true })
    .click();
  await expect(
    page.getByRole("tab", { name: "Activity", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await trigger.click();
  await search.fill("NoSuchTool");
  await expect(page.getByText("No matching tabs or tools.")).toBeVisible();
  await search.press("Escape");
  await expect(trigger).toBeFocused();
  await expect(
    page.getByRole("tab", { name: "Activity", exact: true }),
  ).toBeVisible();
  await trigger.click();
  const box = await page.locator('[data-slot="popover-content"]').boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  await page.screenshot({
    path: test.info().outputPath("workspace-picker.png"),
  });
  expect(errors).toEqual([]);
  expect(
    await page.evaluate(
      () => (window as any).__transcriptServiceAttempts ?? [],
    ),
  ).toEqual([]);
});

test("open-tab overview preserves the selected panel and returns keyboard focus", async ({
  page,
}) => {
  await page.goto("/lab/composer?workbench=1");
  await page
    .getByRole("button", { name: "Open Activity", exact: true })
    .click();
  const show = page.getByRole("button", {
    name: "Show open tabs",
    exact: true,
  });
  await show.click();
  const overview = page.getByRole("region", { name: "Workspace overview" });
  await expect(overview).toBeVisible();
  await expect(
    page.getByRole("tab", { name: "Activity", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page.screenshot({
    path: test.info().outputPath("workspace-overview.png"),
  });
  await overview.getByRole("button", { name: "Switch to Activity" }).click();
  await expect(overview).not.toBeVisible();
  await expect(
    page.getByRole("region", { name: "Agent activity", exact: true }),
  ).toBeVisible();
  await show.click();
  await page.keyboard.press("Escape");
  await expect(show).toBeFocused();
  await expect(overview).not.toBeVisible();
  await show.click();
  await overview.getByRole("button", { name: "Changes", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Review changes" }),
  ).toBeVisible();
  await expect(overview).not.toBeVisible();
  expect(
    await page.evaluate(
      () => (window as any).__transcriptServiceAttempts ?? [],
    ),
  ).toEqual([]);
});
