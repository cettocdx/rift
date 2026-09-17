import { expect, test } from "@playwright/test";
const buildFixture = require("./workbench-file-build.cjs");
let fixture: { js: string; css: string };
test.beforeAll(async () => {
  fixture = await buildFixture();
});

test("file selection retains provider edits and saves via workspace controls", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => {
    errors.push("Unexpected request");
    return route.abort();
  });
  await page.setContent(
    '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div></body></html>',
  );
  await page.addStyleTag({ content: fixture.css });
  await page.addScriptTag({ content: fixture.js });
  const mobile = Boolean(info.project.use.isMobile);
  const files = page.getByRole("button", { name: "Files", exact: true });
  if (mobile) await files.tap();
  const file = page.getByRole("treeitem", { name: "hello.ts", exact: true });
  if (mobile) await file.tap();
  else await file.click();
  const contents = page.getByRole("textbox", { name: "File contents" });
  await expect(contents).toBeVisible();
  if (mobile) {
    await expect(
      page.getByText("Terminal session", { exact: true }),
    ).toBeHidden();
    await expect(files).toHaveAttribute("aria-pressed", "true");
  }
  await expect(contents).toHaveValue("export const greeting = 'hello';");
  await contents.fill("unsaved changes");
  await expect(contents).toHaveAttribute("data-dirty", "true");
  await contents.evaluate((el) =>
    el.setAttribute("data-retained-editor", "yes"),
  );
  if (mobile) {
    await page.getByRole("button", { name: "Agent", exact: true }).tap();
    await expect(contents).toBeHidden();
    await files.tap();
  }
  if (mobile) await file.tap();
  else await file.click();
  await expect(contents).toBeVisible();
  await expect(contents).toHaveValue("unsaved changes");
  await expect(contents).toHaveAttribute("data-retained-editor", "yes");
  expect(
    await page.evaluate(() => (window as any).workbenchFileEvidence),
  ).toEqual({ reads: 1, writes: [] });
  if (mobile) {
    await page.getByRole("button", { name: "More workspace actions" }).tap();
    const save = page.getByRole("menuitem", {
      name: "Save active file",
      exact: true,
    });
    await expect(save).toBeEnabled();
    await save.tap();
  } else {
    await page
      .getByRole("button", { name: "Save active file", exact: true })
      .click();
  }
  await expect(contents).toHaveAttribute("data-dirty", "false");
  await expect(contents).toHaveAttribute(
    "data-saved-content",
    "unsaved changes",
  );
  await expect(contents).toHaveAttribute("data-revision", "revision-2");
  expect(
    await page.evaluate(() => (window as any).workbenchFileEvidence),
  ).toEqual({
    reads: 1,
    writes: [
      {
        path: "hello.ts",
        content: "unsaved changes",
        expectedRevision: "revision-1",
      },
    ],
  });
  if (mobile) {
    await page.getByRole("button", { name: "More workspace actions" }).tap();
    await expect(
      page.getByRole("menuitem", { name: "Save active file", exact: true }),
    ).toBeDisabled();
    await page.keyboard.press("Escape");
  } else {
    await expect(
      page.getByRole("button", { name: "Save active file", exact: true }),
    ).toBeDisabled();
  }
  const geometry = await contents.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return {
      visible: r.width > 0 && r.height > 0,
      inside:
        r.left >= 0 &&
        r.right <= innerWidth &&
        r.top >= 0 &&
        r.bottom <= innerHeight,
    };
  });
  expect(geometry).toEqual({ visible: true, inside: true });
  if (!mobile) await expect(file).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const screenshotPath = info.outputPath("file-editor.png");
  await page.screenshot({ path: screenshotPath });
  await info.attach("file-editor", {
    path: screenshotPath,
    contentType: "image/png",
  });
  expect(errors).toEqual([]);
});

test("failed save preserves dirty provider state and can retry with touch", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => {
    errors.push("Unexpected request");
    return route.abort();
  });
  await page.setContent(
    '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div></body></html>',
  );
  await page.addStyleTag({ content: fixture.css });
  await page.addScriptTag({ content: fixture.js });
  const mobile = Boolean(info.project.use.isMobile);
  if (mobile)
    await page.getByRole("button", { name: "Files", exact: true }).tap();
  const file = page.getByRole("treeitem", { name: "hello.ts", exact: true });
  if (mobile) await file.tap();
  else await file.click();
  const contents = page.getByRole("textbox", { name: "File contents" });
  await contents.fill("keep this edit");
  await page.evaluate(() => {
    (window as any).workbenchFileControls.failNextWrite = true;
  });
  const save = async () => {
    if (mobile) {
      await page.getByRole("button", { name: "More workspace actions" }).tap();
      const action = page.getByRole("menuitem", {
        name: "Save active file",
        exact: true,
      });
      await expect(action).toBeEnabled();
      await action.tap();
    } else {
      await page
        .getByRole("button", { name: "Save active file", exact: true })
        .click();
    }
  };
  await save();
  await expect(contents).toHaveAttribute("data-error", "Fixture save failed");
  await expect(contents).toHaveAttribute("data-status", "ready");
  await expect(contents).toHaveAttribute("data-dirty", "true");
  await expect(contents).toHaveValue("keep this edit");
  await expect(contents).toHaveAttribute(
    "data-saved-content",
    "export const greeting = 'hello';",
  );
  await expect(contents).toHaveAttribute("data-revision", "revision-1");
  const write = {
    path: "hello.ts",
    content: "keep this edit",
    expectedRevision: "revision-1",
  };
  expect(
    await page.evaluate(() => (window as any).workbenchFileEvidence),
  ).toEqual({ reads: 1, writes: [write] });
  const retry = page.getByRole("button", { name: "Retry save", exact: true });
  await expect(retry).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("Fixture save failed");
  if (mobile) {
    const bounds = await retry.boundingBox();
    expect(bounds!.height).toBeGreaterThanOrEqual(44);
    expect(bounds!.width).toBeGreaterThanOrEqual(44);
    await retry.tap();
  } else {
    await retry.click();
  }
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(contents).toHaveAttribute("data-error", "");
  await expect(contents).toHaveAttribute("data-dirty", "false");
  await expect(contents).toHaveAttribute(
    "data-saved-content",
    "keep this edit",
  );
  await expect(contents).toHaveAttribute("data-revision", "revision-2");
  expect(
    await page.evaluate(() => (window as any).workbenchFileEvidence),
  ).toEqual({ reads: 1, writes: [write, write] });
  expect(errors).toEqual([]);
});

test("explorer supports keyboard traversal, touch targets and nested refresh", async ({
  page,
  browserName,
}, info) => {
  await page.setContent(
    '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div></body></html>',
  );
  await page.addStyleTag({ content: fixture.css });
  await page.addScriptTag({ content: fixture.js });
  const mobile = Boolean(info.project.use.isMobile);
  if (mobile)
    await page.getByRole("button", { name: "Files", exact: true }).tap();
  const tree = page.getByRole("tree");
  const src = tree.getByRole("treeitem", { name: "src", exact: true });
  await expect(src).toBeVisible();
  const refresh = page.getByRole("button", { name: "Refresh Explorer" });
  await refresh.focus();
  await page.keyboard.press(browserName === "webkit" ? "Alt+Tab" : "Tab");
  await expect(src).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(src).toHaveAttribute("aria-expanded", "true");
  const nested = tree.getByRole("treeitem", { name: "nested.ts", exact: true });
  await expect(nested).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(nested).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(
    tree.getByRole("treeitem", { name: "hello.ts", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Home");
  await expect(src).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(nested).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(src).toBeFocused();
  expect(await tree.locator('[role="treeitem"][tabindex="0"]').count()).toBe(1);
  const row = src.locator(":scope > div").first();
  const rowBox = await row.boundingBox();
  const refreshBox = await refresh.boundingBox();
  expect(rowBox!.height).toBeGreaterThanOrEqual(mobile ? 44 : 24);
  expect(refreshBox!.height).toBeGreaterThanOrEqual(mobile ? 44 : 24);
  await page.evaluate(() => {
    (window as any).workbenchFileControls.newNestedFile = true;
  });
  await refresh.click();
  await expect(
    tree.getByRole("treeitem", { name: "new.ts", exact: true }),
  ).toBeVisible();
  await expect(nested).toHaveCount(0);
  await tree.getByRole("treeitem", { name: "new.ts", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("textbox", { name: "File contents" }),
  ).toBeVisible();
});
