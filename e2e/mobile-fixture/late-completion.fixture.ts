import { expect, test } from "@playwright/test";

for (const following of [false, true]) {
  test(`late file and usage receipts preserve source, draft and following=${following}`, async ({
    page,
  }, info) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/*", (route) => {
      if (
        new URL(route.request().url()).origin !== "http://127.0.0.1:3043" ||
        route.request().method() !== "GET"
      ) {
        errors.push("Unexpected service request");
        return route.abort();
      }
      return route.continue();
    });
    await page.goto("/lab/composer?codeLines=80");
    await page.evaluate(() => (window as any).__transcript.code(true));
    const row = page.locator('[data-message-id="code-lifecycle"]');
    await expect(row.locator("pre code")).toContainText("line79");
    await page.evaluate(() => (window as any).__transcript.finishCode());
    const draft = page.getByRole("textbox", { name: "Message RIFT" });
    await draft.fill("Keep my next instruction — henüz gönderme.");
    const source = await row.locator("pre code").textContent();
    const anchor = page.locator('[data-message-id="transcript-0"] h2').first();
    if (following)
      await page.evaluate(() => (window as any).__transcript.latest());
    else
      await anchor.evaluate((element) => {
        const scroll = document.querySelector(".messages-scroll")!;
        scroll.scrollTop +=
          element.getBoundingClientRect().top -
          scroll.getBoundingClientRect().top -
          20;
      });
    const geometry = () =>
      page.evaluate(() => {
        const s = document.querySelector(".messages-scroll")!;
        const a = document.querySelector(
          '[data-message-id="transcript-0"] h2',
        )!;
        return {
          following: (window as any).__transcript.snapshot().following,
          offset: a.getBoundingClientRect().top - s.getBoundingClientRect().top,
          gap: s.scrollHeight - s.clientHeight - s.scrollTop,
        };
      });
    await expect.poll(async () => (await geometry()).following).toBe(following);
    const before = await geometry();
    await page.evaluate(() => (window as any).__transcript.lateUsage());
    await expect(row).toContainText("Worked for 3s · 2.4k · $0.13");
    // No part/status/usage changes accompany the file receipt or its correction.
    for (const corrected of [false, true]) {
      await page.evaluate(
        (corrected) => (window as any).__transcript.lateFile(corrected),
        corrected,
      );
      const name = corrected ? "final-frame.svg" : "draft-frame.svg";
      const img = row.getByRole("img", { name, exact: true });
      await expect(img).toHaveCount(1);
      await expect(img).toHaveAttribute(
        "src",
        `/scroll-fixture.svg?receipt=${corrected ? 2 : 1}`,
      );
      // Eager request models a late response while the reader stays elsewhere.
      await img.evaluate(
        (element) => ((element as HTMLImageElement).loading = "eager"),
      );
      await expect
        .poll(() =>
          img.evaluate((element) => (element as HTMLImageElement).naturalWidth),
        )
        .toBeGreaterThan(0);
      await expect(row.getByRole("img")).toHaveCount(1);
      if (following)
        await expect
          .poll(async () => Math.abs((await geometry()).gap))
          .toBeLessThan(2);
      else
        await expect
          .poll(async () => Math.abs((await geometry()).offset - before.offset))
          .toBeLessThan(2);
      expect((await geometry()).following).toBe(following);
      await expect(draft).toHaveValue(
        "Keep my next instruction — henüz gönderme.",
      );
      expect(await row.locator("pre code").textContent()).toBe(source);
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(errors).toEqual([]);
    await info.attach("late-receipts", {
      body: JSON.stringify({ before, after: await geometry() }),
      contentType: "application/json",
    });
    await page.screenshot({ path: info.outputPath("late-completion.png") });
  });
}
