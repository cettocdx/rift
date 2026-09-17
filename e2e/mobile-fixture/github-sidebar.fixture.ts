import { expect, test, type Locator, type Page } from "@playwright/test";

// Contract simulation: this does not open an OS keyboard or Safari browser UI.
async function simulateVisualViewport(page: Page) {
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
    Reflect.set(window, "fixtureViewport", (next: Partial<typeof values>) => {
      Object.assign(values, next);
      viewport.dispatchEvent(new Event("resize"));
      viewport.dispatchEvent(new Event("scroll"));
    });
  });
}

async function updateVisualViewport(
  page: Page,
  values: { height?: number; offsetTop?: number; scale?: number },
) {
  await page.evaluate(
    (next) => Reflect.get(window, "fixtureViewport")(next),
    values,
  );
}

async function expectWithinVisibleViewport(locator: Locator) {
  await expect
    .poll(() =>
      locator.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const viewport = window.visualViewport!;
        const top = viewport.offsetTop;
        const bottom = top + viewport.height;
        return rect.top >= top && rect.bottom <= bottom;
      }),
    )
    .toBe(true);
}

test("repository controls fit a simulated keyboard viewport on first open and after filtering", async ({
  page,
}, info) => {
  test.skip(
    !info.project.name.startsWith("mobile"),
    "Mobile visual viewport contract",
  );
  await simulateVisualViewport(page);
  const state = await setup(page);
  await page.goto("/?theme=dark");
  // Shrink before the first portal attaches; an open-render effect misses it.
  await updateVisualViewport(page, { height: 420, offsetTop: 35 });
  await page
    .getByRole("button", { name: "Add repositories", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Add GitHub repositories" });
  const filter = dialog.getByRole("textbox", {
    name: "Filter loaded GitHub repositories",
  });
  const done = dialog.getByRole("button", { name: "Done", exact: true });
  await expect(dialog).toHaveCSS("opacity", "1");
  await expectWithinVisibleViewport(dialog);
  await expectWithinVisibleViewport(filter);
  await expectWithinVisibleViewport(done);
  await expect(filter).toHaveCSS("font-size", "16px");
  await filter.fill("REPOSITORY-17");
  await updateVisualViewport(page, { height: 360, offsetTop: 60 });
  const row = dialog.getByRole("button", {
    name: "Add repository fixture-org/repository-17",
    exact: true,
  });
  await expectWithinVisibleViewport(filter);
  await expectWithinVisibleViewport(row);
  await expectWithinVisibleViewport(done);
  await row.click();
  await expect(dialog.getByRole("status")).toContainText(
    "repository-17 added to Projects.",
  );
  await expectWithinVisibleViewport(done);
  await page.screenshot({
    path: info.outputPath("simulated-keyboard-repositories.png"),
  });
  // The shared observer must restore regular geometry when the user pinch-zooms.
  await updateVisualViewport(page, { scale: 1.5 });
  await expect(dialog).not.toHaveAttribute("data-rift-visible-viewport");
  await updateVisualViewport(page, { height: 400, offsetTop: 20, scale: 1 });
  await expectWithinVisibleViewport(dialog);
  await done.click();
  await expect(dialog).toHaveCount(0);
  expect(state.errors).toEqual([]);
});

test("manual token controls remain reachable in a simulated keyboard viewport", async ({
  page,
}, info) => {
  test.skip(
    !info.project.name.startsWith("mobile"),
    "Mobile visual viewport contract",
  );
  await simulateVisualViewport(page);
  await page.goto("/?theme=light&connected=false");
  await updateVisualViewport(page, { height: 420, offsetTop: 35 });
  await page
    .getByRole("button", { name: "Connect GitHub", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Connect GitHub",
    exact: true,
  });
  await dialog
    .getByRole("button", { name: "Advanced: use a personal access token" })
    .click();
  const token = dialog.getByLabel("Personal access token");
  await token.fill("ghp_fixture_only");
  await updateVisualViewport(page, { height: 360, offsetTop: 60 });
  await expect(dialog).toHaveCSS("opacity", "1");
  await expectWithinVisibleViewport(dialog);
  const connect = dialog.getByRole("button", { name: "Connect", exact: true });
  await connect.scrollIntoViewIfNeeded();
  await expectWithinVisibleViewport(token);
  await expectWithinVisibleViewport(connect);
  await expect(token).toHaveCSS("font-size", "16px");
  await expect(token).toHaveValue("ghp_fixture_only");
  await page.screenshot({
    path: info.outputPath("simulated-keyboard-token.png"),
  });
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toHaveCount(0);
});
const repositories = Array.from({ length: 18 }, (_, index) => ({
  id: index + 1,
  fullName:
    index === 0
      ? "fixture-org/very-long-repository-name-for-overflow-acceptance"
      : "fixture-org/repository-" + index,
  defaultBranch: "main",
  private: index === 0,
}));
async function setup(page: Page, failPage = 0) {
  let calls = 0;
  const requestedPages: number[] = [];
  const opened: string[] = [];
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== "http://127.0.0.1:3058") return route.abort();
    if (url.pathname === "/api/github/repositories/open") {
      const { fullName } = route.request().postDataJSON();
      opened.push(fullName);
      return route.fulfill({
        json: {
          project: {
            id:
              fullName === repositories[0].fullName
                ? "project-existing"
                : "project-new",
            name: fullName,
            type: "app",
          },
        },
      });
    }
    if (url.pathname === "/api/github/repositories") {
      const number = Number(url.searchParams.get("page"));
      requestedPages.push(number);
      if (number === failPage && calls++ === 0)
        return route.fulfill({
          status: 503,
          json: { error: "Fixture GitHub is temporarily unavailable." },
        });
      return route.fulfill({
        json: {
          repositories:
            number === 1
              ? repositories
              : [
                  repositories[17],
                  {
                    id: 19,
                    fullName: "fixture-org/second-page",
                    defaultBranch: "develop",
                    private: false,
                  },
                ],
          hasMore: number === 1,
        },
      });
    }
    return route.continue();
  });
  return { requestedPages, opened, errors };
}
for (const theme of ["light", "dark"]) {
  test(`connected list, overflow, filter, pagination, keyboard and open in ${theme}`, async ({
    page,
  }, info) => {
    const state = await setup(page);
    await page.goto(`/?theme=${theme}`);
    const trigger = page.getByRole("button", {
      name: "Add repositories",
      exact: true,
    });
    await expect(trigger).toBeVisible();
    expect(state.requestedPages).toEqual([]);
    await trigger.click();
    const region = page.getByRole("dialog", {
      name: "Add GitHub repositories",
    });
    const rows = region.getByRole("button", {
      name: /^(Add|Open) repository /,
    });
    await expect(rows).toHaveCount(18);
    await expect(region).toHaveCSS("opacity", "1");
    await expect(page.locator("html")).toHaveClass(new RegExp(theme));
    const dimensions = await region
      .locator("[aria-busy]")
      .evaluate((element) => ({
        height: element.clientHeight,
        scroll: element.scrollHeight,
      }));
    expect(dimensions.height).toBeLessThanOrEqual(672);
    expect(dimensions.scroll).toBeGreaterThan(dimensions.height);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const longRow = rows.first();
    expect(
      await longRow
        .locator("span.font-medium")
        .evaluate((element) => element.scrollWidth > element.clientWidth),
    ).toBe(true);
    await expect(longRow.locator('[aria-label="Private"]')).toBeVisible();
    await page.screenshot({ path: info.outputPath(`${theme}-connected.png`) });
    const filter = page.getByRole("textbox", {
      name: "Filter loaded GitHub repositories",
    });
    await filter.fill("NOT-AVAILABLE");
    await expect(
      region.getByText("No matches in loaded repositories."),
    ).toBeVisible();
    await filter.fill("REPOSITORY-17");
    await expect(rows).toHaveCount(1);
    await filter.fill("");
    await page.getByRole("button", { name: "Load more repositories" }).click();
    await expect(rows).toHaveCount(19);
    await expect(
      page.getByRole("button", { name: "Load more repositories" }),
    ).toHaveCount(0);
    expect(state.requestedPages).toEqual([1, 2]);
    await filter.focus();
    await page.keyboard.press(
      info.project.name.includes("webkit") ? "Alt+Tab" : "Tab",
    );
    await page.keyboard.press(
      info.project.name.includes("webkit") ? "Alt+Tab" : "Tab",
    );
    await expect(longRow).toBeFocused();
    expect(
      await longRow.evaluate((element) => element.matches(":focus-visible")),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath(`${theme}-keyboard-focus.png`),
    });
    await page.keyboard.press("Enter");
    await expect.poll(() => state.opened.length).toBe(1);
    await expect
      .poll(() => page.evaluate(() => (window as any).fixtureCalls))
      .toContainEqual({ name: "goPurpose", args: ["app", "existing-chat"] });
    const calls = await page.evaluate(() => (window as any).fixtureCalls);
    expect(calls).toContainEqual({
      name: "setTemporaryChatsEnabled",
      args: [false],
    });
    expect(calls).toContainEqual({ name: "closeSidebar", args: [] });
    if (info.project.name.startsWith("mobile"))
      expect(calls).toContainEqual({
        name: "setChatSidebarOpen",
        args: [false],
      });
    expect(state.errors).toEqual([]);
  });
}
test("load error and retry recover; new repository initializes a project chat", async ({
  page,
}, info) => {
  const state = await setup(page, 1);
  await page.goto("/?theme=dark");
  await page
    .getByRole("button", { name: "Add repositories", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Fixture GitHub is temporarily unavailable.",
  );
  await page.screenshot({ path: info.outputPath("load-error.png") });
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /^(Add|Open) repository / }),
  ).toHaveCount(18);
  expect(state.requestedPages).toEqual([1, 1]);
  await page
    .getByRole("button", {
      name: "Add repository fixture-org/repository-1",
      exact: true,
    })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "fixture-org/repository-1 added to Projects.",
  );
  expect(await page.evaluate(() => (window as any).fixtureCalls ?? [])).toEqual(
    [],
  );
  await page
    .getByRole("button", {
      name: "Open repository fixture-org/repository-1",
      exact: true,
    })
    .click();
  await expect
    .poll(() => page.evaluate(() => (window as any).fixtureCalls))
    .toContainEqual({ name: "goPurpose", args: ["app"] });
  const calls = await page.evaluate(() => (window as any).fixtureCalls);
  expect(
    calls.find((call: any) => call.name === "initializeNewChat").args,
  ).toEqual(["app", expect.objectContaining({ id: "project-new" })]);
  await page.getByRole("button", { name: "GitHub", exact: true }).click();
  await expect(page.getByRole("textbox")).toHaveCount(0);
  await page.getByRole("button", { name: "GitHub", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Add repositories", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Add repositories", exact: true })
    .click();
  await expect(page.getByRole("textbox")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Add repositories", exact: true }),
  ).toBeFocused();
  expect(state.errors).toEqual([]);
});

test("failed second page retries page two without discarding loaded repositories", async ({
  page,
}, info) => {
  const state = await setup(page, 2);
  await page.goto("/?theme=dark");
  await page
    .getByRole("button", { name: "Add repositories", exact: true })
    .click();
  const rows = page.getByRole("button", { name: /^(Add|Open) repository / });
  await expect(rows).toHaveCount(18);
  await page.getByRole("button", { name: "Load more repositories" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Fixture GitHub is temporarily unavailable.",
  );
  await expect(rows).toHaveCount(18);
  await page.screenshot({ path: info.outputPath("page-two-error.png") });
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(rows).toHaveCount(19);
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(state.requestedPages).toEqual([1, 2, 2]);
  expect(state.errors).toEqual([]);
});

test("web connection shows server errors in place and navigates only after a successful start", async ({
  page,
}, info) => {
  const authorizeRequests: unknown[] = [];
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/github/authorize", async (route) => {
    expect(route.request().method()).toBe("POST");
    authorizeRequests.push(route.request().postDataJSON());
    if (authorizeRequests.length === 1)
      return route.fulfill({
        status: 503,
        json: {
          error: "GitHub connection is not configured on this RIFT server.",
          code: "not_configured",
        },
      });
    return route.fulfill({
      json: {
        url: "https://github.com/login/oauth/authorize?client_id=fixture&state=fixture",
      },
    });
  });
  await page.route("https://github.com/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>GitHub consent fixture</title><p>GitHub authorization fixture</p>",
    }),
  );
  await page.goto("/?theme=dark&connected=false");
  await page
    .getByRole("button", { name: "Connect GitHub", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Connect GitHub",
    exact: true,
  });
  await dialog.getByRole("button", { name: "Continue with GitHub" }).click();
  await expect(dialog.getByRole("alert")).toContainText(
    "GitHub connection is not configured",
  );
  await expect(page).toHaveURL(/127\.0\.0\.1:3058/);
  await expect(
    dialog.getByRole("button", { name: "Continue with GitHub" }),
  ).toBeEnabled();
  await expect(
    dialog.getByRole("button", {
      name: "Advanced: use a personal access token",
    }),
  ).toBeVisible();
  await expect(dialog).toHaveCSS("opacity", "1");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: info.outputPath("connection-error.png") });
  await dialog.getByRole("button", { name: "Continue with GitHub" }).click();
  await expect(page).toHaveURL(
    "https://github.com/login/oauth/authorize?client_id=fixture&state=fixture",
  );
  expect(authorizeRequests).toEqual([
    { return_to: "/?theme=dark&connected=false" },
    { return_to: "/?theme=dark&connected=false" },
  ]);
  expect(errors).toEqual([]);
});

test("manual token verification failure remains editable in the connection dialog", async ({
  page,
}, info) => {
  await page.route("https://api.github.com/user", (route) =>
    route.fulfill({ status: 403, json: { message: "Forbidden" } }),
  );
  await page.goto("/?theme=light&connected=false");
  await page
    .getByRole("button", { name: "Connect GitHub", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Connect GitHub",
    exact: true,
  });
  await dialog
    .getByRole("button", { name: "Advanced: use a personal access token" })
    .click();
  const token = dialog.getByLabel("Personal access token");
  await token.fill("ghp_fixture_only");
  await dialog.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText(
    "GitHub could not verify this token.",
  );
  await expect(token).toHaveValue("ghp_fixture_only");
  await expect(token).toBeEditable();
  await expect(
    dialog.getByRole("button", { name: "Continue with GitHub" }),
  ).toBeEnabled();
  await expect(dialog).toHaveCSS("opacity", "1");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("token-verification-error.png"),
  });
});
