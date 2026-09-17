import { test, expect } from "@playwright/test";

test("project form follows reduced visual viewport and preserves draft and actions", async ({
  page,
}, info) => {
  await page.addInitScript(() => {
    const viewport = new EventTarget();
    Object.assign(viewport, {
      height: innerHeight,
      width: innerWidth,
      offsetTop: 0,
      offsetLeft: 0,
      scale: 1,
    });
    Object.defineProperty(window, "visualViewport", {
      value: viewport,
      configurable: true,
    });
  });
  await page.goto("/lab/workspace-targets?section=new-project");
  const opener = page.getByRole("button", { name: "New project fixture" });
  await opener.focus();
  await opener.press("Enter");
  const dialog = page.getByRole("dialog", { name: "New project", exact: true });
  await expect(
    dialog.getByRole("textbox", { name: "Project name" }),
  ).toBeFocused();
  await dialog
    .getByRole("textbox", { name: "Project name" })
    .fill("Mobile workspace");
  if (info.project.use.hasTouch) {
    await page.evaluate(() => {
      Object.assign(visualViewport!, { height: 320, offsetTop: 40 });
      visualViewport!.dispatchEvent(new Event("resize"));
    });
    await expect
      .poll(async () => {
        const b = await dialog.boundingBox();
        return b!.y >= 39 && b!.y + b!.height <= 361;
      })
      .toBe(true);
  }
  await dialog
    .getByRole("combobox", { name: "Agent workflow" })
    .scrollIntoViewIfNeeded();
  await dialog
    .getByRole("combobox", { name: "Agent workflow" })
    .selectOption({ index: 1 });
  const create = dialog.getByRole("button", {
    name: "Create project",
    exact: true,
  });
  await create.scrollIntoViewIfNeeded();
  if (info.project.use.hasTouch) {
    const b = await create.boundingBox();
    expect(b!.y).toBeGreaterThanOrEqual(40);
    expect(b!.y + b!.height).toBeLessThanOrEqual(360);
  }
  await create.click();
  await expect(page.locator("output")).toHaveText("Mobile workspace:app");
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
  await opener.focus();
  await opener.press("Enter");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
  await opener.press("Enter");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
});
