import { expect, test, type Page } from "@playwright/test";
const anchorSelector = '[data-message-id="transcript-0"] h2:nth-of-type(2)';
async function frames(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}
async function open(page: Page, path = "/lab/composer") {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/*", (route) =>
    new URL(route.request().url()).origin ===
    new URL(String(test.info().project.use.baseURL || "http://127.0.0.1:3038"))
      .origin
      ? route.continue()
      : route.abort(),
  );
  await page.goto(path);
  await page.locator(anchorSelector).waitFor();
  await frames(page);
  return errors;
}
async function command(page: Page, name: string, value?: boolean) {
  await page.evaluate(
    ({ name, value }) => (window as any).__transcript[name](value),
    { name, value },
  );
  await frames(page);
}
async function dockPanel(
  page: Page,
  placement: "Dock panel below" | "Dock panel on right",
) {
  await page
    .getByRole("button", { name: "Add workspace tab", exact: true })
    .click();
  await page.getByRole("option", { name: placement, exact: true }).click();
}
async function state(page: Page) {
  return page.evaluate((selector) => {
    const scroll = document.querySelector(".messages-scroll") as HTMLElement;
    const anchor = document.querySelector(selector)!;
    return {
      ...(window as any).__transcript.snapshot(),
      offset:
        anchor.getBoundingClientRect().top - scroll.getBoundingClientRect().top,
      clientHeight: scroll.clientHeight,
      bottomGap: scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop,
      outerTop: document.querySelector("[data-rift-chat-surface]")!.scrollTop,
    };
  }, anchorSelector);
}
async function readAtAnchor(page: Page, offset: number) {
  await page.locator(anchorSelector).evaluate((e, offset) => {
    const s = document.querySelector(".messages-scroll")!;
    s.scrollTop +=
      e.getBoundingClientRect().top - s.getBoundingClientRect().top - offset;
  }, offset);
  await frames(page);
  expect((await state(page)).following).toBe(false);
}
for (const offset of [0, -12]) {
  test(`hidden transcript preserves the semantic anchor at offset${offset} during reflow`, async ({
    page,
  }, info) => {
    test.skip(
      !info.project.use.isMobile,
      "Zero-height mobile question dock scenario",
    );
    const errors = await open(page);
    await readAtAnchor(page, offset);
    const before = await state(page);
    await command(page, "question", true);
    await page.setViewportSize({
      width: info.project.use.viewport!.width,
      height: 240,
    });
    await frames(page);
    expect((await state(page)).clientHeight).toBe(0);
    await command(page, "panel", true);
    await command(page, "append");
    await page.setViewportSize(info.project.use.viewport!);
    await command(page, "question", false);
    const after = await state(page);
    await info.attach("anchor-geometry", {
      body: JSON.stringify({ before, after }, null, 2),
      contentType: "application/json",
    });
    await page.screenshot({ path: info.outputPath("restored-anchor.png") });
    expect(Math.abs(after.offset - before.offset)).toBeLessThan(2);
    expect(after.following).toBe(false);
    expect(errors).toEqual([]);
  });
}
test("reading remains anchored through real image insertion, appended output and panel reflow", async ({
  page,
}, info) => {
  const errors = await open(page);
  await readAtAnchor(page, 0);
  const before = await state(page);
  await command(page, "image");
  await expect
    .poll(() =>
      page
        .locator('[data-message-id="transcript-0"] img')
        .evaluateAll((images) =>
          images.some((img) => (img as HTMLImageElement).naturalWidth > 0),
        ),
    )
    .toBe(true);
  await command(page, "append");
  await command(page, "panel", true);
  await command(page, "panel", false);
  const after = await state(page);
  await info.attach("media-anchor", {
    body: JSON.stringify({ before, after }),
    contentType: "application/json",
  });
  expect(Math.abs(after.offset - before.offset)).toBeLessThan(2);
  expect(after.following).toBe(false);
  expect(errors).toEqual([]);
});
test("explicit Latest follows appended output after keyboard-sized resize and restore", async ({
  page,
}, info) => {
  const errors = await open(page);
  await command(page, "latest");
  await expect
    .poll(async () => Math.abs((await state(page)).bottomGap))
    .toBeLessThan(2);
  if (info.project.use.isMobile) {
    await command(page, "question", true);
    await page.setViewportSize({
      width: info.project.use.viewport!.width,
      height: 240,
    });
    await frames(page);
  }
  await command(page, "append");
  await command(page, "panel", true);
  await page.setViewportSize(info.project.use.viewport!);
  await command(page, "question", false);
  await expect
    .poll(async () => Math.abs((await state(page)).bottomGap))
    .toBeLessThan(2);
  expect((await state(page)).following).toBe(true);
  expect((await state(page)).outerTop).toBe(0);
  expect(errors).toEqual([]);
});

for (const changed of [false, true]) {
  test(`retained route restores midhistory after away/back with changed layout ${changed}`, async ({
    page,
  }, info) => {
    const errors = await open(page);
    const selector = `[data-message-id="transcript-18"] h2:nth-of-type(${changed ? 1 : 2})`;
    let releaseImage: () => void = () => {};
    let imageRequested = false;
    if (changed) {
      const ready = new Promise<void>((resolve) => {
        releaseImage = resolve;
      });
      await page.route("**/scroll-fixture.svg", async (route) => {
        imageRequested = true;
        await ready;
        await route.continue();
      });
    }
    const offset = () =>
      page
        .locator(selector)
        .evaluate(
          (e) =>
            e.getBoundingClientRect().top -
            document.querySelector(".messages-scroll")!.getBoundingClientRect()
              .top,
        );
    // Materialize the actual row before measuring descendants of a skipped
    // content-visibility subtree; descendant rectangles alone can be misleading.
    await page.locator('[data-message-id="transcript-18"]').evaluate((e) => {
      const scroll = document.querySelector(".messages-scroll")!;
      scroll.scrollTop +=
        e.getBoundingClientRect().top - scroll.getBoundingClientRect().top;
    });
    await frames(page);
    // Explicit reader positioning, never locator auto-scroll.
    for (let i = 0; i < 3; i++) {
      await page.locator(selector).evaluate((e, offset) => {
        const s = document.querySelector(".messages-scroll")!;
        s.scrollTop +=
          e.getBoundingClientRect().top -
          s.getBoundingClientRect().top -
          offset;
      }, -12);
      await frames(page);
    }
    const hitMessage = () =>
      page.evaluate(() => {
        const rect = document
          .querySelector(".messages-scroll")!
          .getBoundingClientRect();
        const row = document
          .querySelector('[data-message-id="transcript-18"]')!
          .getBoundingClientRect();
        const x = Math.min(
          rect.right - 24,
          Math.max(rect.left + 24, row.left + 80),
        );
        return document
          .elementFromPoint(x, rect.top + 40)
          ?.closest("[data-message-id]")
          ?.getAttribute("data-message-id");
      });
    await expect.poll(hitMessage).toBe("transcript-18");
    const before = await offset();
    await page.screenshot({ path: info.outputPath("before-route.png") });
    await page.evaluate(() => (window as any).__route.away(true));
    await expect(page.getByTestId("away-route")).toBeVisible();
    if (changed)
      await page.evaluate(() => {
        (window as any).__route.panel(true);
        (window as any).__route.image(18);
      });
    await page.evaluate(() => (window as any).__route.away(false));
    await page.locator(selector).waitFor();
    await frames(page);
    await expect.poll(hitMessage).toBe("transcript-18");
    const beforeImage = await offset();
    expect(Math.abs(beforeImage - before)).toBeLessThan(2);
    if (changed) {
      // Lazy images are not requested above the viewport. Briefly reveal the
      // reserved frame, then resume reading while its actual response is held.
      await page
        .locator('[data-message-id="transcript-18"] img')
        .evaluate((e) => {
          const scroll = document.querySelector(".messages-scroll")!;
          scroll.scrollTop +=
            e.getBoundingClientRect().top -
            scroll.getBoundingClientRect().top -
            20;
        });
      await expect.poll(() => imageRequested).toBe(true);
      await page.locator(selector).evaluate((e, targetOffset) => {
        const scroll = document.querySelector(".messages-scroll")!;
        scroll.scrollTop +=
          e.getBoundingClientRect().top -
          scroll.getBoundingClientRect().top -
          targetOffset;
      }, beforeImage);
      await frames(page);
    }
    releaseImage();
    if (changed)
      await expect
        .poll(() =>
          page
            .locator('[data-message-id="transcript-18"] img')
            .evaluateAll((imgs) =>
              imgs.some((img) => (img as HTMLImageElement).naturalWidth > 0),
            ),
        )
        .toBe(true);
    await frames(page);
    const after = await offset();
    await info.attach("retained-route-offset", {
      body: JSON.stringify({ before, beforeImage, after }),
      contentType: "application/json",
    });
    await page.screenshot({ path: info.outputPath("retained-route.png") });
    await frames(page);
    const settled = await offset();
    await info.attach("post-screenshot-offset", {
      body: JSON.stringify({
        before,
        after,
        settled,
        saved: await page.evaluate(() =>
          (window as any).__transcript.snapshot(),
        ),
      }),
      contentType: "application/json",
    });
    await page.screenshot({
      path: info.outputPath("retained-route-settled.png"),
    });
    await expect.poll(hitMessage).toBe("transcript-18");
    expect(Math.abs(settled - before)).toBeLessThan(2);
    expect(Math.abs(beforeImage - before)).toBeLessThan(2);
    expect(Math.abs(after - before)).toBeLessThan(2);
    expect((await state(page)).following).toBe(false);
    await command(page, "latest");
    await page.evaluate(() => (window as any).__route.away(true));
    await expect(page.getByTestId("away-route")).toBeVisible();
    await page.evaluate(() => (window as any).__route.away(false));
    await page.locator(selector).waitFor();
    await command(page, "append");
    await expect
      .poll(async () => Math.abs((await state(page)).bottomGap))
      .toBeLessThan(2);
    expect((await state(page)).following).toBe(true);
    expect(errors).toEqual([]);
  });
}

test("growing plain paragraphs retain their DOM and resume rich Markdown immediately", async ({
  page,
}) => {
  const errors = await open(page);
  const write = async (text: string, streaming = true) => {
    await page.evaluate(
      ({ text, streaming }) =>
        (window as any).__transcript.paragraph(text, streaming),
      { text, streaming },
    );
    await frames(page);
  };
  const short = "Stable sentence. ".repeat(30) + "Ready.";
  const long = short + " Türkçe açıklama. ".repeat(150);
  await write(short);
  const message = page.locator('[data-message-id="paragraph-lifecycle"]');
  const paragraph = message.locator("p").first();
  await expect(paragraph).toHaveText(short);
  await paragraph.evaluate((node) => {
    (window as any).__paragraphNode = node;
  });
  await write(long);
  await expect(paragraph).toHaveText(long.trimEnd());
  await expect
    .poll(() =>
      paragraph.evaluate((node) => node === (window as any).__paragraphNode),
    )
    .toBe(true);
  const rich = long + " [Report](https://example.com/report) and **verified**.";
  await write(rich);
  await expect(
    message.getByRole("link", { name: "Report", exact: true }),
  ).toHaveAttribute("href", "https://example.com/report");
  await expect(message.locator('[data-streamdown="strong"]')).toHaveText(
    "verified",
  );
  await expect
    .poll(() =>
      paragraph.evaluate((node) => node === (window as any).__paragraphNode),
    )
    .toBe(true);
  await write(long + " www.example.com");
  await expect(
    message.getByRole("link", { name: "www.example.com", exact: true }),
  ).toHaveAttribute("href", "http://www.example.com/");
  await write("Corrected answer. " + "Plain final text. ".repeat(100), false);
  await expect(paragraph).toHaveText(
    "Corrected answer. " + "Plain final text. ".repeat(100).trimEnd(),
  );
  await expect(message.getByRole("link")).toHaveCount(0);
  await expect
    .poll(() =>
      paragraph.evaluate((node) => node === (window as any).__paragraphNode),
    )
    .toBe(true);
  expect(errors).toEqual([]);
});

for (const codeLines of [401, 80])
  test(`closing a streamed code fence retains wrap and reading anchor (${codeLines} lines)`, async ({
    page,
  }, info) => {
    const errors = await open(page, `/lab/composer?codeLines=${codeLines}`);
    await command(page, "code", false);
    const expectedSource = Array.from(
      { length: codeLines },
      (_, i) => `const line${i} = "${"readable wrapping output ".repeat(6)}";`,
    ).join("\n");
    const block = page.locator(
      '[data-message-id="code-lifecycle"] [data-ui="cursor-code-block"]',
    );
    await block.evaluate((node) => {
      const s = document.querySelector(".messages-scroll")!;
      s.scrollTop +=
        node.getBoundingClientRect().top - s.getBoundingClientRect().top - 20;
    });
    await frames(page);
    await block
      .getByRole("button", { name: "Enable text wrapping", exact: true })
      .click();
    await expect(
      block.getByRole("button", { name: "Disable text wrapping", exact: true }),
    ).toBeVisible();
    await block.locator("pre").evaluate((node) => {
      (window as any).__codePre = node;
      const walker = document.createTreeWalker(
        node.querySelector("code")!,
        NodeFilter.SHOW_TEXT,
      );
      let text: Node | null;
      while (
        (text = walker.nextNode()) &&
        !text.textContent!.includes("line40")
      ) {}
      if (!text) throw new Error("Missing source line40");
      const start = text.textContent!.indexOf("line40");
      const range = document.createRange();
      range.setStart(text, start);
      range.setEnd(text, start + 6);
      const s = document.querySelector(".messages-scroll")!;
      s.scrollTop +=
        range.getBoundingClientRect().top - s.getBoundingClientRect().top - 40;
    });
    await frames(page);
    const snapshot = () =>
      block.locator("pre").evaluate((node) => {
        const walker = document.createTreeWalker(
          node.querySelector("code")!,
          NodeFilter.SHOW_TEXT,
        );
        let text: Node | null;
        while (
          (text = walker.nextNode()) &&
          !text.textContent!.includes("line40")
        ) {}
        if (!text) throw new Error("Missing source line40");
        const start = text.textContent!.indexOf("line40");
        const range = document.createRange();
        range.setStart(text, start);
        range.setEnd(text, start + 6);
        const r = range.getBoundingClientRect(),
          s = document
            .querySelector(".messages-scroll")!
            .getBoundingClientRect();
        return {
          whiteSpace: getComputedStyle(node).whiteSpace,
          samePre: node === (window as any).__codePre,
          offset: r.top - s.top,
          painted: node.contains(
            document.elementFromPoint(
              r.left + Math.min(5, r.width / 2),
              r.top + Math.min(5, r.height / 2),
            ),
          ),
          following: (window as any).__transcript.snapshot().following,
        };
      });
    const before = await snapshot();
    expect(before.whiteSpace).toBe("pre-wrap");
    expect(before.painted).toBe(true);
    expect(before.following).toBe(false);
    await page.screenshot({ path: info.outputPath("code-before-close.png") });
    await page.evaluate(() => {
      const samples: any[] = [];
      (window as any).__codeFrames = samples;
      const sample = () => {
        const block = document.querySelector(
          '[data-message-id="code-lifecycle"] [data-ui="cursor-code-block"]',
        )!;
        const pre = block.querySelector("pre"),
          s = document.querySelector(".messages-scroll")!;
        const r = pre?.getBoundingClientRect();
        samples.push({
          at: performance.now(),
          height: r?.height,
          top: r?.top,
          width: r?.width,
          whiteSpace: pre && getComputedStyle(pre).whiteSpace,
          fontSize: pre && getComputedStyle(pre).fontSize,
          lineHeight: pre && getComputedStyle(pre).lineHeight,
          scrollTop: s.scrollTop,
          scrollHeight: s.scrollHeight,
          text: pre
            ? pre.textContent?.slice(0, 40)
            : block.textContent?.slice(-100),
        });
        if (samples.length < 60)
          (window as any).__codeFrame = requestAnimationFrame(sample);
      };
      sample();
    });
    await command(page, "code", true);
    for (const phase of ["closed", "prose", "ready"]) {
      if (phase === "prose") await command(page, "continueCode");
      if (phase === "ready") await command(page, "finishCode");
      if (codeLines === 80)
        await expect
          .poll(() => block.locator("pre code span").count())
          .toBeGreaterThan(0);
      if (phase !== "closed")
        await expect(
          page.getByText("Continuation after the code fence.", { exact: true }),
        ).toBeAttached();
      expect(await block.locator("pre").textContent()).toBe(
        expectedSource + "\n",
      );
      const after = await snapshot();
      if (phase === "closed") {
        await frames(page);
        const samples = await page.evaluate(() => {
          cancelAnimationFrame((window as any).__codeFrame);
          return (window as any).__codeFrames;
        });
        expect(samples.length).toBeGreaterThan(1);
        for (const sample of samples) {
          expect(sample.height).toBeGreaterThan(0);
          expect(sample.text).toBe(expectedSource.slice(0, 40));
        }
        await info.attach("highlight-frame-geometry", {
          body: JSON.stringify(samples),
          contentType: "application/json",
        });
      }
      await info.attach(`code-lifecycle-${phase}`, {
        body: JSON.stringify({ before, after }),
        contentType: "application/json",
      });
      await page.screenshot({
        path: info.outputPath(`code-after-${phase}.png`),
      });
      expect(after.whiteSpace).toBe("pre-wrap");
      if (codeLines === 401) expect(after.samePre).toBe(true);
      expect(after.painted).toBe(true);
      expect(Math.abs(after.offset - before.offset)).toBeLessThan(2);
      expect(after.following).toBe(false);
    }
    expect(errors).toEqual([]);
  });

const pairedWorkbench = process.env.RIFT_WORKBENCH_PAIRED === "1";
const workbenchScenarios: Array<{
  mode: "reading" | "following";
  transitions: boolean;
}> = pairedWorkbench
  ? [
      { mode: "reading", transitions: false },
      { mode: "reading", transitions: true },
    ]
  : [
      { mode: "reading", transitions: true },
      { mode: "following", transitions: true },
    ];
for (const { mode, transitions } of workbenchScenarios) {
  test(`actual workspace preserves ${mode}${pairedWorkbench ? (transitions ? " with transitions" : " with stable panel") : ""} during sustained code and media`, async ({
    page,
  }, info) => {
    test.skip(!!info.project.use.isMobile, "Bounded desktop dock integration");
    const errors = await open(
      page,
      `/lab/composer?workbench=1${pairedWorkbench ? "&realistic=1" : ""}`,
    );
    let releaseImage!: () => void;
    let imageStarted = false;
    const heldImage = new Promise<void>((resolve) => {
      releaseImage = resolve;
    });
    await page.route("**/scroll-fixture.svg", async (route) => {
      imageStarted = true;
      await heldImage;
      await route.fulfill({ response: await route.fetch() });
    });
    const samples: unknown[] = [];
    const measure = async (label: string) => {
      const value = await page.evaluate(
        ({ selector, label }) => {
          const s = document.querySelector<HTMLElement>(".messages-scroll")!;
          const anchor = document.querySelector<HTMLElement>(selector)!;
          const rect = anchor.getBoundingClientRect();
          const scrollRect = s.getBoundingClientRect();
          const pane = document.querySelector<HTMLElement>(
            "[data-rift-tool-pane]",
          )!;
          const activity = document.querySelector<HTMLElement>(
            '[aria-label="Agent activity"]',
          );
          const ar = activity?.getBoundingClientRect();
          return {
            label,
            time: performance.now(),
            offset: rect.top - scrollRect.top,
            painted:
              rect.height > 0 &&
              anchor.contains(
                document.elementFromPoint(
                  rect.left + Math.min(30, rect.width / 2),
                  rect.top + Math.min(8, rect.height / 2),
                ),
              ),
            following: (window as any).__transcript.snapshot().following,
            bottomGap: s.scrollHeight - s.clientHeight - s.scrollTop,
            scrollTop: s.scrollTop,
            height: s.clientHeight,
            documentTop: document.scrollingElement?.scrollTop,
            pane: {
              visible: pane.dataset.visible,
              width: pane.clientWidth,
              height: pane.clientHeight,
            },
            activityPainted:
              !!ar &&
              !!activity?.contains(
                document.elementFromPoint(
                  ar.left + ar.width / 2,
                  ar.top + Math.min(20, ar.height / 2),
                ),
              ),
            stream: (() => {
              const { progress, total } = (
                window as any
              ).__transcript.streamSnapshot();
              return { progress, total };
            })(),
          };
        },
        { selector: anchorSelector, label },
      );
      samples.push(value);
      return value;
    };
    const assertPosition = async (label: string, offset: number) => {
      await expect
        .poll(
          async () => {
            const s = await measure(label);
            return mode === "reading"
              ? s.painted && !s.following && Math.abs(s.offset - offset) <= 1
              : s.following && Math.abs(s.bottomGap) <= 1;
          },
          { timeout: 5000 },
        )
        .toBe(true);
    };
    try {
      await command(page, "image");
      await expect.poll(() => imageStarted).toBe(true);
      await page.getByTestId("chat-input").fill("Unsent draft stays intact");
      if (pairedWorkbench) {
        await page
          .getByRole("button", { name: "Open Activity", exact: true })
          .click();
        await expect(
          page.getByLabel("Agent activity", { exact: true }),
        ).toBeVisible();
      }
      if (mode === "reading") await readAtAnchor(page, 40);
      else await command(page, "latest");
      const before = await measure("before");
      await page.evaluate(() => {
        const host = window as any;
        host.__workspaceFrames = [];
        host.__workspaceActions = [];
        host.__workspaceFrameStop = false;
        let previous = performance.now();
        function frame(now: number) {
          if (host.__workspaceFrameStop) return;
          const s = document.querySelector<HTMLElement>(".messages-scroll")!;
          host.__workspaceFrames.push({
            time: now,
            gap: now - previous,
            progress: host.__transcript.streamSnapshot().progress,
            placement: document
              .querySelector("[data-rift-dock-placement]")
              ?.getAttribute("data-rift-dock-placement"),
            maximized: document
              .querySelector("[data-rift-dock-maximized]")
              ?.getAttribute("data-rift-dock-maximized"),
            top: s.scrollTop,
            height: s.clientHeight,
            scrollHeight: s.scrollHeight,
          });
          previous = now;
          if (
            !host.__workspaceFrameStop &&
            host.__workspaceFrames.length < 1200
          )
            requestAnimationFrame(frame);
        }
        requestAnimationFrame(frame);
        host.__transcript.startSustained();
      });
      if (pairedWorkbench) {
        const mark = async (name: string, edge: string) =>
          page.evaluate(
            ({ name, edge }) => {
              const host = window as any;
              host.__workspaceActions.push({
                name,
                edge,
                time: performance.now(),
                progress: host.__transcript.streamSnapshot().progress,
              });
            },
            { name, edge },
          );
        const checkpoint = async (count: number) =>
          expect
            .poll(
              async () =>
                page.evaluate(
                  () => (window as any).__transcript.streamSnapshot().progress,
                ),
              { intervals: [25] },
            )
            .toBeGreaterThanOrEqual(count);
        const action = async (count: number, label: string, button: string) => {
          await checkpoint(count);
          await mark(label, "start");
          if (transitions) {
            if (
              button === "Dock panel below" ||
              button === "Dock panel on right"
            )
              await dockPanel(page, button);
            else
              await page
                .getByRole("button", { name: button, exact: true })
                .click();
          }
          await mark(label, "end");
        };
        await action(6, "dock-bottom", "Dock panel below");
        await assertPosition("paired-bottom", before.offset);
        await action(12, "maximize", "Expand panel");
        if (transitions)
          await expect(
            page.locator("[data-rift-conversation-column]"),
          ).toBeHidden();
        await checkpoint(18);
        await mark("release-image", "start");
        releaseImage();
        await expect
          .poll(() =>
            page
              .locator('[data-message-id="transcript-0"] img')
              .evaluate((img) => (img as HTMLImageElement).naturalWidth),
          )
          .toBeGreaterThan(0);
        await mark("release-image", "end");
        await action(24, "restore", "Restore panel");
        await assertPosition("paired-restored", before.offset);
        await action(30, "dock-right", "Dock panel on right");
        await assertPosition("paired-right", before.offset);
        await action(36, "hide", "Hide workspace panel");
        await assertPosition("paired-hidden", before.offset);
        await checkpoint(42);
        await mark("edit-input", "start");
      } else {
        await page
          .getByRole("button", { name: "Open Activity", exact: true })
          .click();
        await expect(
          page.getByLabel("Agent activity", { exact: true }),
        ).toBeVisible();
        await assertPosition("right", before.offset);
        expect((await measure("right-body")).activityPainted).toBe(true);
        await dockPanel(page, "Dock panel below");
        await assertPosition("bottom", before.offset);
        const progress = (await measure("pre-expand")).stream.progress;
        await page
          .getByRole("button", { name: "Expand panel", exact: true })
          .click();
        await expect(
          page.locator("[data-rift-conversation-column]"),
        ).toBeHidden();
        await expect
          .poll(async () => (await measure("expanded")).stream.progress)
          .toBeGreaterThan(progress + 2);
        releaseImage();
        await expect
          .poll(() =>
            page
              .locator('[data-message-id="transcript-0"] img')
              .evaluate((img) => (img as HTMLImageElement).naturalWidth),
          )
          .toBeGreaterThan(0);
        await page
          .getByRole("button", { name: "Restore panel", exact: true })
          .click();
        await assertPosition("restored", before.offset);
        await dockPanel(page, "Dock panel on right");
        await assertPosition("right-again", before.offset);
        await page
          .getByRole("button", { name: "Hide workspace panel", exact: true })
          .click();
        await assertPosition("hidden", before.offset);
      }
      expect(
        (await measure("stream-still-active")).stream.progress,
      ).toBeLessThan(before.stream.total);
      await page.getByTestId("chat-input").focus();
      await page.getByTestId("chat-input").press("End");
      await page
        .getByTestId("chat-input")
        .pressSequentially(" + edit", { delay: 1 });
      await expect(page.getByTestId("chat-input")).toBeFocused();
      if (pairedWorkbench)
        await page.evaluate(() =>
          (window as any).__workspaceActions.push({
            name: "edit-input",
            edge: "end",
            time: performance.now(),
            progress: (window as any).__transcript.streamSnapshot().progress,
          }),
        );
      await assertPosition("typed-while-streaming", before.offset);
      await expect
        .poll(
          async () => {
            const value = (await measure("stream-finished")).stream;
            return value.progress > value.total;
          },
          { timeout: 10000 },
        )
        .toBe(true);
      if (pairedWorkbench)
        await expect
          .poll(() => page.evaluate(() => (window as any).__workspaceFrameStop))
          .toBe(true);
      await assertPosition("complete", before.offset);
      const exact = await page.evaluate(() => {
        const host = window as any;
        return {
          expected: host.__transcript.streamSnapshot().expected,
          attempts: host.__transcriptServiceAttempts ?? [],
        };
      });
      expect(
        await page
          .locator('[data-message-id="sustained-output"] pre code')
          .textContent(),
      ).toBe(
        Array.from(
          { length: 40 },
          (_, i) => `const streamed${i} = "${"complete source ".repeat(5)}";\n`,
        ).join(""),
      );
      await expect(
        page.locator('[data-message-id="sustained-output"] p'),
      ).toHaveText(
        Array.from(
          { length: 18 },
          (_, i) =>
            `Streaming paragraph ${i}. Continued local output remains complete.`,
        ),
      );
      await expect(
        page.locator('[data-message-id="sustained-output"] h2'),
      ).toHaveText("Live mixed output");
      await expect(page.getByTestId("chat-input")).toHaveValue(
        "Unsent draft stays intact + edit",
      );
      expect((await measure("end")).documentTop).toBe(before.documentTop);
      expect(exact.attempts).toEqual([]);
      expect(errors).toEqual([]);
      // Screenshot capture is intentionally outside the RAF measurement window.
      await page.evaluate(() => {
        (window as any).__workspaceFrameStop = true;
      });
      await page.screenshot({ path: info.outputPath(`workspace-${mode}.png`) });
    } finally {
      releaseImage?.();
      await page.unrouteAll({ behavior: "wait" });
      const frames = await page.evaluate(() => {
        (window as any).__workspaceFrameStop = true;
        return {
          frames: (window as any).__workspaceFrames ?? [],
          actions: (window as any).__workspaceActions ?? [],
          stream: (window as any).__transcript.streamSnapshot(),
        };
      });
      await info.attach("workspace-transition-evidence", {
        body: JSON.stringify(
          { samples, ...frames, errors, paired: pairedWorkbench, transitions },
          null,
          2,
        ),
        contentType: "application/json",
      });
    }
  });
}
