import { expect, test, type Locator } from "@playwright/test";

async function reading(pre: Locator, move = false) {
  return pre.evaluate((node, move) => {
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
    const range = document.createRange();
    const start = text.textContent!.indexOf("line40");
    range.setStart(text, start);
    range.setEnd(text, start + 6);
    const scroll = document.querySelector(".messages-scroll")!;
    if (move)
      scroll.scrollTop +=
        range.getBoundingClientRect().top -
        scroll.getBoundingClientRect().top -
        40;
    const rect = range.getBoundingClientRect();
    return {
      offset: rect.top - scroll.getBoundingClientRect().top,
      whiteSpace: getComputedStyle(node).whiteSpace,
      painted: node.contains(
        document.elementFromPoint(
          rect.left + Math.min(5, rect.width / 2),
          rect.top + Math.min(5, rect.height / 2),
        ),
      ),
      text: node.textContent,
    };
  }, move);
}

for (const codeLines of [401, 80]) {
  test(`route return preserves code Wrap and the same visible source line (${codeLines} lines)`, async ({
    page,
  }, info) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/*", (route) =>
      new URL(route.request().url()).origin === "http://127.0.0.1:3039"
        ? route.continue()
        : route.abort(),
    );
    await page.goto(`/lab/composer?codeLines=${codeLines}`);
    await page.evaluate(() => {
      (window as any).__transcript.code(true);
      (window as any).__transcript.finishCode();
    });
    const block = page.locator(
      '[data-message-id="code-lifecycle"] [data-ui="cursor-code-block"]',
    );
    if (codeLines === 80)
      await expect(block.locator("pre code span").first()).toBeAttached();
    await block
      .getByRole("button", { name: "Enable text wrapping", exact: true })
      .click();
    await expect(
      block.getByRole("button", { name: "Disable text wrapping", exact: true }),
    ).toBeVisible();
    await reading(block.locator("pre"), true);
    await expect
      .poll(async () => (await reading(block.locator("pre"))).painted)
      .toBe(true);
    const before = await reading(block.locator("pre"));
    expect(before.text).toBe(
      Array.from(
        { length: codeLines },
        (_, i) =>
          `const line${i} = "${"readable wrapping output ".repeat(6)}";`,
      ).join("\n") + "\n",
    );
    await page.screenshot({ path: info.outputPath("before-route.png") });
    await page.evaluate(() => (window as any).__route.away(true));
    await expect(page.getByTestId("away-route")).toBeVisible();
    await page.evaluate(() => (window as any).__route.away(false));
    await block.locator("pre").waitFor({ state: "attached" });
    if (codeLines === 80)
      await expect(block.locator("pre code span").first()).toBeAttached();
    await expect
      .poll(async () => {
        const current = await reading(block.locator("pre"));
        return (
          current.whiteSpace === "pre-wrap" &&
          current.painted &&
          Math.abs(current.offset - before.offset) <= 1
        );
      })
      .toBe(true);
    const after = await reading(block.locator("pre"));
    await info.attach("code-route-reading", {
      contentType: "application/json",
      body: JSON.stringify({ before, after }, null, 2),
    });
    await page.screenshot({ path: info.outputPath("after-route.png") });
    expect(after.text).toBe(before.text);
    expect(after.whiteSpace).toBe("pre-wrap");
    expect(after.painted).toBe(true);
    expect(Math.abs(after.offset - before.offset)).toBeLessThanOrEqual(1);
    expect(
      await block
        .getByRole("button", { name: "Disable text wrapping", exact: true })
        .count(),
    ).toBe(1);
    expect(errors).toEqual([]);
  });
}
