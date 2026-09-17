import { expect, test, type Page } from "@playwright/test";

async function sample(page: Page, finish: boolean) {
  return page.evaluate(async (finish) => {
    const host = window as any;
    const state = host.__completionProfile;
    const first = state.entries.length;
    const frames: { time: number; gap: number }[] = [];
    let previous = performance.now();
    const started = previous;
    let stopped = false;
    const frame = (time: number) => {
      if (stopped) return;
      frames.push({ time, gap: time - previous });
      previous = time;
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    host.__transcript.completionCheckpoint(finish);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    stopped = true;
    return {
      started,
      stopped: performance.now(),
      frames,
      entries: state.entries.slice(first),
    };
  }, finish);
}

for (const held of [true, false]) {
  test(`completion attribution Activity ${held ? "held ready" : "normal"}`, async ({
    page,
  }, info) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/*", (route) =>
      new URL(route.request().url()).origin === "http://127.0.0.1:3039"
        ? route.continue()
        : route.abort(),
    );
    await page.goto(
      `/lab/composer?workbench=1&realistic=1&completion=1${held ? "&holdActivityReady=1" : ""}`,
    );
    await page
      .getByRole("button", { name: "Open Activity", exact: true })
      .click();
    await expect(
      page.getByLabel("Agent activity", { exact: true }),
    ).toBeVisible();
    await page.evaluate(() => (window as any).__transcript.prepareCompletion());
    const output = page.locator('[data-message-id="sustained-output"]');
    await expect(
      output.locator('[data-testid="shiki-container"] pre code span').first(),
    ).toBeAttached();
    await expect(
      page.locator('[data-testid="shiki-container"] pre'),
    ).toHaveCount(3);
    const sourceBefore = await page
      .locator('[data-ui="cursor-code-block"] pre')
      .allTextContents();
    expect(sourceBefore[2]).toContain('const streamed39 = "complete source');
    await page
      .getByTestId("chat-input")
      .fill("Unsent completion diagnostic draft");
    const anchor = page.locator('[data-message-id="transcript-0"] h2').nth(1);
    await anchor.evaluate((node) => {
      const scroll = document.querySelector(".messages-scroll")!;
      scroll.scrollTop +=
        node.getBoundingClientRect().top -
        scroll.getBoundingClientRect().top -
        40;
    });
    const position = () =>
      anchor.evaluate((node) => {
        const scroll = document.querySelector(".messages-scroll")!;
        const box = node.getBoundingClientRect();
        return {
          offset: box.top - scroll.getBoundingClientRect().top,
          painted: !!node.contains(
            document.elementFromPoint(box.left + 10, box.top + 8),
          ),
        };
      });
    await expect.poll(async () => (await position()).painted).toBe(true);
    const before = await position();
    const setup = await page.evaluate(
      () => (window as any).__completionProfile.entries,
    );
    expect(
      setup.some(
        (event: any) =>
          event.kind === "react-commit" && event.actualDuration > 0,
      ),
    ).toBe(true);
    expect(setup.some((event: any) => event.kind === "markdown-parse")).toBe(
      true,
    );
    expect(setup.some((event: any) => event.kind === "shiki-render")).toBe(
      true,
    );
    const unchanged = await sample(page, false);
    const completion = await sample(page, true);
    const after = await position();
    expect(after.painted).toBe(true);
    expect(Math.abs(after.offset - before.offset)).toBeLessThanOrEqual(1);
    expect(
      await page.locator('[data-ui="cursor-code-block"] pre').allTextContents(),
    ).toEqual(sourceBefore);
    expect(await output.locator("p").allTextContents()).toHaveLength(18);
    await expect(page.getByTestId("chat-input")).toHaveValue(
      "Unsent completion diagnostic draft",
    );
    for (const sample of [unchanged, completion]) {
      expect(
        sample.entries
          .filter((entry: any) => entry.kind === "message-reference")
          .every((entry: any) => entry.unchanged),
      ).toBe(true);
    }
    expect(
      completion.entries.some(
        (entry: any) =>
          entry.kind === "react-commit" && entry.id === "Messages",
      ),
    ).toBe(true);
    expect(errors).toEqual([]);
    expect(
      await page.evaluate(
        () => (window as any).__transcriptServiceAttempts ?? [],
      ),
    ).toEqual([]);
    await info.attach("completion-attribution", {
      contentType: "application/json",
      body: JSON.stringify(
        {
          build: "development React, attribution only",
          held,
          before,
          after,
          sourceCharacters: sourceBefore.map((source) => source.length),
          setup,
          unchanged,
          completion,
        },
        null,
        2,
      ),
    });
    await page.screenshot({ path: info.outputPath("after-completion.png") });
  });
}
