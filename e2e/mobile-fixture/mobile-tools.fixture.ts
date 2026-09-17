import { expect, test, type Locator, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("embedded preview loads same-origin ES modules from its verified separate origin", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    // Safari ignores Chromium's progressive viewport enhancement. Keep all
    // script/network errors, including opaque-origin module CORS failures.
    if (
      message.type() === "error" &&
      message.text() !==
        'Viewport argument key "interactive-widget" not recognized and ignored.'
    )
      errors.push(message.text());
  });
  await page.route("**/api/preview/status?**", (route) =>
    route.fulfill({
      json: {
        chatId: "mobile-preview-fixture",
        previewUrl: "https://preview.rift.test/app",
        status: "running",
        url: "https://preview.rift.test/app",
      },
    }),
  );
  // Deliberately no CORS header: just like a Vite server serving its own modules.
  await page.route("https://preview.rift.test/**", (route) =>
    route.fulfill({
      contentType: route.request().url().endsWith(".js")
        ? "text/javascript"
        : "text/html",
      body: route.request().url().endsWith(".js")
        ? 'document.body.innerHTML = "<button>Module ready</button>"; document.querySelector("button").onclick = e => e.target.textContent = "Module interacted";'
        : '<!doctype html><meta name="viewport" content="width=device-width"><script type="module" src="/main.js"></script>',
    }),
  );
  await page.goto("/lab/composer?mobileTools=1&modulePreview=1");
  await page.getByRole("button", { name: "Open mobile preview" }).tap();
  const frame = page.frameLocator('iframe[title="Web page preview"]');
  await frame.getByRole("button", { name: "Module ready" }).tap();
  await expect(
    frame.getByRole("button", { name: "Module interacted" }),
  ).toBeVisible();
  await page.screenshot({ path: info.outputPath("module-preview.png") });
  expect(errors).toEqual([]);
});

for (const clipboardMode of ["missing", "denied"] as const) {
  test(`preview copy survives ${clipboardMode} clipboard without losing the interactive frame`, async ({
    page,
  }, info) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript((mode) => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value:
          mode === "missing"
            ? undefined
            : {
                writeText: () =>
                  Promise.reject(
                    new DOMException("Fixture denial", "NotAllowedError"),
                  ),
              },
      });
    }, clipboardMode);
    await page.goto("/lab/composer?mobileTools=1&realistic=1&realPreview=1");
    await page
      .getByRole("textbox", { name: "Message RIFT" })
      .fill("Keep my draft while copying.");
    await page.getByRole("button", { name: "Open mobile preview" }).tap();
    const dialog = page.getByRole("dialog", { name: "Live Preview" });
    const frame = page.frameLocator('iframe[title="App preview"]');
    await frame.getByRole("button", { name: "Try preview" }).tap();
    const url = await dialog
      .locator('iframe[title="App preview"]')
      .getAttribute("src");
    await dialog.getByRole("button", { name: "Copy preview link" }).tap();
    const fallback = dialog.getByRole("textbox", { name: "Preview link" });
    await expect(fallback).toHaveValue(url!);
    await dialog.getByRole("button", { name: "Select preview link" }).tap();
    expect(
      await fallback.evaluate((element) => {
        const input = element as HTMLInputElement;
        return {
          start: input.selectionStart,
          end: input.selectionEnd,
          font: parseFloat(getComputedStyle(input).fontSize),
        };
      }),
    ).toEqual({ start: 0, end: url!.length, font: 16 });
    await expectWithinVisibleViewport(fallback);
    await expect(
      frame.getByRole("button", { name: "Interacted" }),
    ).toBeVisible();
    await page.screenshot({
      path: info.outputPath(`preview-copy-${clipboardMode}.png`),
    });
    await dialog.getByRole("button", { name: "Dismiss copy link" }).tap();
    await expect(fallback).toHaveCount(0);
    await expect(
      frame.getByRole("button", { name: "Interacted" }),
    ).toBeVisible();
    await dialog.getByRole("button", { name: "Close Live Preview" }).tap();
    await expect(
      page.getByRole("textbox", { name: "Message RIFT" }),
    ).toHaveValue("Keep my draft while copying.");
    expect(errors).toEqual([]);
  });
}

test("transient revalidation preserves the interactive preview and retry does not reload it", async ({
  page,
}, info) => {
  let probe = "running";
  let frameLoads = 0;
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (
      new URL(request.url()).pathname === "/preview-fixture" &&
      request.resourceType() === "document"
    )
      frameLoads++;
  });
  await page.route("**/api/preview/status?**", (route) => {
    if (probe === "running") return route.continue();
    return route.fulfill({
      status: probe === "denied" ? 403 : 503,
      json: { error: "Fixture observation failure" },
    });
  });
  await page.goto("/lab/composer?mobileTools=1&realistic=1&realPreview=1");
  await page.getByRole("button", { name: "Open mobile preview" }).tap();
  const dialog = page.getByRole("dialog", { name: "Live Preview" });
  const frame = page.frameLocator('iframe[title="App preview"]');
  await frame.getByRole("button", { name: "Try preview" }).tap();
  await expect(frame.getByRole("button", { name: "Interacted" })).toBeVisible();
  const activate = async (active: boolean) => {
    await page.evaluate(
      (value) => Reflect.get(window, "__setFixturePreviewActive")(value),
      active,
    );
    // Observe the actual active prop reaching the health effect via the retry
    // button where available; yield a committed render before toggling again.
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
  };
  await activate(false);
  probe = "unreachable";
  await activate(true);
  await expect(
    dialog.getByText("Couldn’t recheck preview. Keeping your open preview."),
  ).toBeVisible();
  await expect(frame.getByRole("button", { name: "Interacted" })).toBeVisible();
  await page.screenshot({
    path: info.outputPath("preview-retained-on-network-failure.png"),
  });
  probe = "running";
  await dialog.getByRole("button", { name: "Check again" }).tap();
  await expect(dialog.getByRole("button", { name: "Check again" })).toHaveCount(
    0,
  );
  await expect(frame.getByRole("button", { name: "Interacted" })).toBeVisible();
  expect(frameLoads).toBe(1);
  await activate(false);
  probe = "denied";
  await activate(true);
  await expect(
    dialog.getByText("Preview unavailable", { exact: true }),
  ).toBeVisible();
  await expect(page.locator('iframe[title="App preview"]')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("terminal download preserves the full command and output", async ({
  page,
}, info) => {
  // Exercise the anchor path used by Safari and browsers without a file picker.
  // Native desktop IPC and Chromium's picker have separate unit coverage.
  await page.addInitScript(() => {
    Reflect.deleteProperty(window, "showSaveFilePicker");
  });
  await page.goto("/lab/composer?mobileTools=1&longTerminal=1");
  await page
    .getByRole("textbox", { name: "Message RIFT" })
    .fill("Keep the download draft.");
  await page.getByRole("button", { name: "Open mobile activity" }).tap();
  const dialog = page.getByRole("dialog", { name: "RIFT computer" });
  const downloadEvent = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Download", exact: true }).tap();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe("terminal-output.txt");
  const target = info.outputPath("terminal-output.txt");
  await download.saveAs(target);
  expect(await download.failure()).toBeNull();
  expect(await readFile(target, "utf8")).toBe(
    "$ printf 'RIFT_TERMINAL_MARKER_" +
      "x".repeat(160) +
      "'\n/home/user\nRIFT_TERMINAL_MARKER_" +
      "x".repeat(160),
  );
  await dialog.getByRole("button", { name: "Close RIFT computer" }).tap();
  await expect(page.getByRole("textbox", { name: "Message RIFT" })).toHaveValue(
    "Keep the download draft.",
  );
});

test("long terminal detail stays inside the full-width mobile dialog", async ({
  page,
}, info) => {
  await page.goto("/lab/composer?mobileTools=1&longTerminal=1");
  await page
    .getByRole("textbox", { name: "Message RIFT" })
    .fill("Keep this draft while reading terminal output.");
  await page.getByRole("button", { name: "Open mobile activity" }).tap();
  const dialog = page.getByRole("dialog", { name: "RIFT computer" });
  await expect(dialog).toHaveCSS("opacity", "1");
  const panel = dialog.getByRole("complementary", {
    name: "Agent activity and computer",
  });
  await expect(panel).toBeVisible();
  for (const element of [
    dialog.locator("[data-mobile-tool-header]"),
    dialog.locator("[data-mobile-tool-content]"),
    panel,
  ]) {
    await expect
      .poll(() =>
        element.evaluate((node) => {
          const box = node.getBoundingClientRect();
          return (
            box.left >= 0 &&
            box.right <= window.innerWidth &&
            box.width <= window.innerWidth
          );
        }),
      )
      .toBe(true);
  }
  const close = dialog.getByRole("button", { name: "Close RIFT computer" });
  await expect(close).toBeVisible();
  await page.screenshot({ path: info.outputPath("long-terminal-fit.png") });
  await close.tap();
  await expect(dialog).not.toBeVisible();
});

// A browser contract simulation, not an OS keyboard or physical-device test.
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
    Reflect.set(
      window,
      "fixtureToolViewport",
      (next: Partial<typeof values>) => {
        Object.assign(values, next);
        viewport.dispatchEvent(new Event("resize"));
        viewport.dispatchEvent(new Event("scroll"));
      },
    );
  });
}

async function reportVisualViewport(
  page: Page,
  values: { height?: number; offsetTop?: number; scale?: number },
) {
  await page.evaluate(
    (next) => Reflect.get(window, "fixtureToolViewport")(next),
    values,
  );
}

async function expectWithinVisibleViewport(locator: Locator) {
  await expect
    .poll(() =>
      locator.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const viewport = window.visualViewport!;
        return (
          rect.top >= viewport.offsetTop &&
          rect.bottom <= viewport.offsetTop + viewport.height
        );
      }),
    )
    .toBe(true);
}

for (const firstOpenShrunk of [true, false]) {
  test(`mobile tool panels follow the visible viewport, initially shrunk: ${firstOpenShrunk}`, async ({
    page,
  }, info) => {
    await simulateVisualViewport(page);
    await page.goto("/lab/composer?mobileTools=1&realistic=1&realPreview=1");
    const draft = page.getByRole("textbox", { name: "Message RIFT" });
    await draft.fill("Keep the draft while using Preview with a keyboard.");
    if (firstOpenShrunk)
      await reportVisualViewport(page, { height: 400, offsetTop: 40 });
    await page.getByRole("button", { name: "Open mobile preview" }).tap();
    const dialog = page.getByRole("dialog", { name: "Live Preview" });
    const address = dialog.getByRole("textbox", { name: "Preview address" });
    await expect(dialog).toHaveCSS("opacity", "1");
    await address.fill("/preview-fixture/second");
    await reportVisualViewport(page, { height: 400, offsetTop: 40 });
    await expectWithinVisibleViewport(dialog);
    await expectWithinVisibleViewport(address);
    await expectWithinVisibleViewport(
      dialog.getByRole("button", { name: "Close Live Preview" }),
    );
    await expectWithinVisibleViewport(
      dialog.locator("[data-mobile-tool-content]"),
    );
    await expect(address).toBeFocused();
    await reportVisualViewport(page, { height: 280, offsetTop: 60 });
    await expectWithinVisibleViewport(dialog);
    await expectWithinVisibleViewport(address);
    await expect(address).toHaveValue("/preview-fixture/second");
    await page.screenshot({ path: info.outputPath("preview-keyboard.png") });
    await dialog
      .getByRole("button", { name: "Show agent activity", exact: true })
      .tap();
    const activity = page.getByRole("dialog", { name: "RIFT computer" });
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await expectWithinVisibleViewport(activity);
    const close = activity.getByRole("button", { name: "Close RIFT computer" });
    await expectWithinVisibleViewport(close);
    // Native pinch panning and desktop layout must keep their own geometry.
    await reportVisualViewport(page, { scale: 1.5 });
    await expect(activity).not.toHaveAttribute("data-rift-visible-viewport");
    await reportVisualViewport(page, { height: 340, offsetTop: 25, scale: 1 });
    await expectWithinVisibleViewport(activity);
    await reportVisualViewport(page, {
      height: page.viewportSize()!.height,
      offsetTop: 0,
    });
    await expect(activity).not.toHaveAttribute("data-rift-visible-viewport");
    await close.tap();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(draft).toHaveValue(
      "Keep the draft while using Preview with a keyboard.",
    );
    await expect(page.locator("[data-rift-chat-root]")).not.toHaveAttribute(
      "inert",
      "",
    );
  });
}

for (const tool of ["activity", "preview"] as const) {
  test(`mobile ${tool} closes by touch and preserves reading/draft during output`, async ({
    page,
  }, info) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/*", (route) =>
      new URL(route.request().url()).origin === "http://127.0.0.1:3045"
        ? route.continue()
        : route.abort(),
    );
    await page.goto("/lab/composer?mobileTools=1&realistic=1");
    const draft = page.getByRole("textbox", { name: "Message RIFT" });
    await draft.fill("Keep my mobile draft while I inspect the running task.");
    const anchor = page.locator(
      '[data-message-id="transcript-0"] h2:nth-of-type(2)',
    );
    // A skipped row has estimated descendant geometry. Bring the target into
    // the rendered viewport before positioning the reader inside that row;
    // measuring it while skipped can misplace setup by an entire paragraph.
    await anchor.scrollIntoViewIfNeeded();
    await expect(anchor).toBeVisible();
    await anchor.evaluate((element) => {
      const scroller = document.querySelector<HTMLElement>(".messages-scroll")!;
      scroller.scrollTop +=
        element.getBoundingClientRect().top -
        scroller.getBoundingClientRect().top -
        12;
    });
    const offset = () =>
      anchor.evaluate(
        (element) =>
          element.getBoundingClientRect().top -
          document.querySelector(".messages-scroll")!.getBoundingClientRect()
            .top,
      );
    // Programmatic setup must finish delivering its scroll event before output
    // changes layout; an immediate scrollTop read is not reader-state readiness.
    await expect
      .poll(() =>
        page.evaluate(() => (window as any).__transcript.snapshot().following),
      )
      .toBe(false);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    const before = await offset();
    expect(Math.abs(before - 12)).toBeLessThan(2);
    await page.evaluate(() => (window as any).__transcript.startSustained());
    const opener = page.getByRole("button", { name: `Open mobile ${tool}` });
    await opener.tap();
    const label = tool === "activity" ? "RIFT computer" : "Live Preview";
    const dialog = page.getByRole("dialog", { name: label });
    await expect(dialog).toBeVisible();
    const close = dialog.getByRole("button", { name: `Close ${label}` });
    await expect(close).toBeVisible();
    const geometry = await close.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const panel = document.querySelector(
        "[data-mobile-tool-content] [data-computer-sidebar], [data-mobile-tool-content] [data-build-preview-panel]",
      )!;
      return {
        width: rect.width,
        height: rect.height,
        top: rect.top,
        right: rect.right,
        panelTop: panel.getBoundingClientRect().top,
        buttonBottom: rect.bottom,
        hit: element.contains(
          document.elementFromPoint(
            rect.x + rect.width / 2,
            rect.y + rect.height / 2,
          ),
        ),
      };
    });
    expect(geometry.width).toBeGreaterThanOrEqual(44);
    expect(geometry.height).toBeGreaterThanOrEqual(44);
    expect(geometry.hit).toBe(true);
    expect(geometry.panelTop).toBeGreaterThanOrEqual(geometry.buttonBottom);
    expect(geometry.right).toBeLessThanOrEqual(
      info.project.use.viewport!.width,
    );
    const progress = await page.evaluate(
      () => (window as any).__transcript.streamSnapshot().progress,
    );
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as any).__transcript.streamSnapshot().progress,
        ),
      )
      .toBeGreaterThan(progress + 3);
    await close.tap();
    await expect(dialog).not.toBeVisible();
    await expect(draft).toHaveValue(
      "Keep my mobile draft while I inspect the running task.",
    );
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            document.activeElement === (window as any).__mobileRestoreTarget,
        ),
      )
      .toBe(true);
    await expect(page.locator("[data-rift-chat-root]")).not.toHaveAttribute(
      "inert",
      "",
    );
    await expect
      .poll(async () => Math.abs((await offset()) - before))
      .toBeLessThan(2);
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            (window as any).__transcript
              .streamSnapshot()
              .events.some((event: any) => event.kind === "complete"),
          ),
        { timeout: 15000 },
      )
      .toBe(true);
    expect(
      await page.evaluate(
        () => (window as any).__transcriptServiceAttempts ?? [],
      ),
    ).toEqual([]);
    expect(errors).toEqual([]);
    await info.attach("mobile-tool-geometry", {
      body: JSON.stringify({ before, after: await offset(), geometry }),
      contentType: "application/json",
    });
  });
}

test("live mobile preview has usable controls and navigates without overflowing", async ({
  page,
}) => {
  await page.goto("/lab/composer?mobileTools=1&realistic=1&realPreview=1");
  await page.getByRole("button", { name: "Open mobile preview" }).tap();
  const dialog = page.getByRole("dialog", { name: "Live Preview" });
  const address = dialog.getByRole("textbox", { name: "Preview address" });
  const sizes = await address.evaluate((el) => ({
    font: parseFloat(getComputedStyle(el).fontSize),
    width: el.getBoundingClientRect().width,
  }));
  expect(sizes.font).toBeGreaterThanOrEqual(16);
  expect(sizes.width).toBeGreaterThanOrEqual(140);
  for (const label of [
    "Reload preview",
    "Switch to mobile width",
    "Copy preview link",
    "Show agent activity",
  ]) {
    const rect = await dialog
      .getByRole("button", { name: label, exact: true })
      .boundingBox();
    expect(rect!.width).toBeGreaterThanOrEqual(44);
    expect(rect!.height).toBeGreaterThanOrEqual(44);
  }
  const frame = page.frameLocator('iframe[title="App preview"]');
  await frame.getByRole("button", { name: "Try preview" }).tap();
  await expect(frame.getByRole("button", { name: "Interacted" })).toBeVisible();
  await address.fill("/preview-fixture/second");
  await address.press("Enter");
  await expect(page.locator('iframe[title="App preview"]')).toHaveAttribute(
    "src",
    /preview-fixture\/second$/,
  );
  await expect(
    frame.getByRole("heading", { name: "Live preview fixture" }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Back", exact: true }).tap();
  await expect(page.locator('iframe[title="App preview"]')).toHaveAttribute(
    "src",
    /preview-fixture$/,
  );
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true,
  );
  await page.setViewportSize({ width: 1200, height: 900 });
  const desktopAddress = await address.boundingBox();
  const desktopAction = await dialog
    .getByRole("button", { name: "Copy preview link" })
    .boundingBox();
  expect(
    Math.abs(
      desktopAddress!.y +
        desktopAddress!.height / 2 -
        desktopAction!.y -
        desktopAction!.height / 2,
    ),
  ).toBeLessThan(2);
  expect(desktopAction!.width).toBe(24);

  await dialog.getByRole("button", { name: "Close Live Preview" }).tap();
  await expect(dialog).not.toBeVisible();
});

test("preview to activity transition keeps the draft and leaves one usable dialog", async ({
  page,
}) => {
  await page.goto("/lab/composer?mobileTools=1&realistic=1&realPreview=1");
  const draft = page.getByRole("textbox", { name: "Message RIFT" });
  await draft.fill("Continue after checking the preview and activity.");
  await page.getByRole("button", { name: "Open mobile preview" }).tap();
  await page
    .getByRole("button", { name: "Show agent activity", exact: true })
    .tap();
  const activity = page.getByRole("dialog", { name: "RIFT computer" });
  await expect(activity).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await expect(page.getByRole("dialog", { name: "Live Preview" })).toHaveCount(
    0,
  );
  const original = page.viewportSize()!;
  await page.setViewportSize({ width: 667, height: 375 });
  const close = activity.getByRole("button", { name: "Close RIFT computer" });
  await expect(close).toBeVisible();
  const bounds = await close.boundingBox();
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(375);
  await close.tap();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.setViewportSize(original);
  await expect(draft).toHaveValue(
    "Continue after checking the preview and activity.",
  );
  await draft.tap();
  await expect(draft).toBeFocused();
  await expect(page.locator("[data-rift-chat-root]")).not.toHaveAttribute(
    "inert",
    "",
  );
  expect(
    await page.evaluate(
      () => (window as any).__transcriptServiceAttempts ?? [],
    ),
  ).toEqual([]);
});

test("mobile activity history retains selection after inspecting a command", async ({
  page,
}) => {
  await page.goto("/lab/composer?mobileTools=1&realistic=1&activityHistory=1");
  const draft = page.getByRole("textbox", { name: "Message RIFT" });
  await draft.fill("Keep this draft while reading earlier work.");
  await page.getByRole("button", { name: "Open mobile activity" }).tap();
  const dialog = page.getByRole("dialog", { name: "RIFT computer" });
  const picker = dialog.getByRole("combobox", { name: "Activity for message" });
  await picker.selectOption("history-user-0");
  await dialog
    .getByRole("button", { name: /Executed.*printf historical-output/ })
    .tap();
  await expect(
    dialog.getByText("historical-output", { exact: true }).first(),
  ).toBeVisible();
  await dialog
    .getByRole("button", { name: "Show agent activity", exact: true })
    .tap();
  await expect(picker).toHaveValue("history-user-0");
  const bounds = await picker.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(
    page.viewportSize()!.width,
  );
  await picker.selectOption("");
  await expect(
    dialog.getByRole("button", { name: /Executed.*printf historical-output/ }),
  ).toHaveCount(0);
  await dialog.getByRole("button", { name: "Close RIFT computer" }).tap();
  await expect(draft).toHaveValue(
    "Keep this draft while reading earlier work.",
  );
});

test("embedded reload detects a paused preview and resumes only the preview", async ({
  page,
}) => {
  let status = "running";
  let checks = 0;
  let resumes = 0;
  const mutations: string[] = [];
  const previewUrl = "https://preview.rift.test/app";
  page.on("request", (request) => {
    if (request.method() === "POST")
      mutations.push(new URL(request.url()).pathname);
  });
  await page.route("**/api/preview/status?**", (route) => {
    checks++;
    return route.fulfill({
      json: {
        chatId: "mobile-preview-fixture",
        previewUrl,
        status,
        url: previewUrl,
      },
    });
  });
  await page.route("**/api/preview/resume", (route) => {
    resumes++;
    expect(route.request().postDataJSON()).toEqual({
      chatId: "mobile-preview-fixture",
      previewUrl,
    });
    status = "running";
    return route.fulfill({
      json: {
        chatId: "mobile-preview-fixture",
        previewUrl,
        status,
        url: previewUrl,
      },
    });
  });
  await page.route("https://preview.rift.test/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><h1>Preview restored</h1>",
    }),
  );
  await page.goto("/lab/composer?mobileTools=1&modulePreview=1");
  const composer = page.getByRole("textbox", { name: "Message RIFT" });
  await composer.fill("Preserve my draft during preview recovery");
  await page.getByRole("button", { name: "Open mobile preview" }).tap();
  const frame = page.frameLocator('iframe[title="Web page preview"]');
  await expect(
    frame.getByRole("heading", { name: "Preview restored" }),
  ).toBeVisible();
  status = "paused";
  await page.getByRole("button", { name: "Reload page", exact: true }).tap();
  await expect(page.getByText("Preview paused", { exact: true })).toBeVisible();
  expect(checks).toBe(2);
  expect(resumes).toBe(0);
  await expect(page.locator('iframe[title="Web page preview"]')).toHaveCount(0);
  await page.getByRole("button", { name: "Resume preview", exact: true }).tap();
  await expect(
    frame.getByRole("heading", { name: "Preview restored" }),
  ).toBeVisible();
  expect(resumes).toBe(1);
  expect(mutations).toEqual(["/api/preview/resume"]);
  await page.getByRole("button", { name: "Close Live Preview" }).tap();
  await expect(composer).toHaveValue(
    "Preserve my draft during preview recovery",
  );
});
