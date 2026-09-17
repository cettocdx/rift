#!/usr/bin/env node
// Local fixture only: no account, model request, or external network required.
const engines = require("playwright");
const assert = require("node:assert/strict");
(async () => {
  const engine = process.env.RIFT_SCROLL_BROWSER || "chromium";
  assert.ok(
    ["chromium", "webkit", "firefox"].includes(engine),
    "Unsupported browser",
  );
  const viewport = {
    width: Number(process.env.RIFT_SCROLL_WIDTH || 1440),
    height: Number(process.env.RIFT_SCROLL_HEIGHT || 960),
  };
  assert.ok(
    Object.values(viewport).every((v) => Number.isInteger(v) && v > 0),
    "Invalid viewport",
  );
  const browser = await engines[engine].launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport,
    });
    let decode;
    const imageGate = new Promise((resolve) => {
      decode = resolve;
    });
    await page.route("**/scroll-fixture.svg", async (route) => {
      await imageGate;
      await route.fulfill({
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><rect width="1600" height="900" fill="#163b42"/><text x="90" y="430" fill="white" font-size="96">RIFT image fixture</text></svg>',
      });
    });
    await page.goto(
      process.env.RIFT_SCROLL_TEST_URL || "http://localhost:3020/lab/scroll",
      { waitUntil: "domcontentloaded" },
    );
    const surface = page.getByTestId("scroll-surface");
    await surface.waitFor();
    await page.getByRole("button", { name: "Latest", exact: true }).click();
    await page.waitForFunction(() => {
      const e = document.querySelector('[data-testid="scroll-surface"]');
      return e && Math.abs(e.scrollHeight - e.clientHeight - e.scrollTop) < 2;
    });
    await page.evaluate(() => {
      const e = document.querySelector('[data-testid="scroll-surface"]');
      const anchor = document.querySelector('[data-testid="paragraph-12"]');
      e.scrollTop +=
        anchor.getBoundingClientRect().top - e.getBoundingClientRect().top;
      window.scrollIdentity = e;
    });
    await page
      .getByTestId("following")
      .filter({ hasText: "Reading" })
      .waitFor();
    const offset = () =>
      page
        .getByTestId("paragraph-12")
        .evaluate(
          (e) =>
            e.getBoundingClientRect().top -
            document
              .querySelector('[data-testid="scroll-surface"]')
              .getBoundingClientRect().top,
        );
    const before = await offset();
    await page.evaluate(() => {
      window.anchorOffsets = [];
      // Observe layout after the production hook's earlier ResizeObserver has
      // applied its pre-paint correction. rAF alone samples before layout/RO.
      window.anchorObserver = new ResizeObserver(() => {
        const e = document.querySelector('[data-testid="scroll-surface"]');
        const a = document.querySelector('[data-testid="paragraph-12"]');
        window.anchorOffsets.push(
          a.getBoundingClientRect().top - e.getBoundingClientRect().top,
        );
      });
      window.anchorObserver.observe(
        document.querySelector('[data-testid="scroll-surface"]'),
      );
      window.anchorObserver.observe(
        document.querySelector('[data-testid="scroll-content"]'),
      );
    });
    await page.getByRole("button", { name: "Toggle panel" }).click();
    await page.waitForTimeout(450);
    const afterOpen = await offset();
    await page.getByRole("button", { name: "Toggle panel" }).click();
    await page.waitForTimeout(450);
    const afterClose = await offset();
    const animationDrift = await page.evaluate((base) => {
      window.anchorObserver.disconnect();
      return Math.max(...window.anchorOffsets.map((v) => Math.abs(v - base)));
    }, before);
    assert.ok(
      animationDrift <= 2,
      `Panel animation displaced reading anchor by ${animationDrift}px`,
    );
    await page.getByRole("button", { name: "Insert image" }).click();
    const frame = page.locator('[data-ui="inline-image-frame"]');
    await frame.waitFor();
    await page.waitForTimeout(100);
    const frameBefore = await frame.boundingBox();
    const afterInsert = await offset();
    // The image is above the reading position. WebKit correctly defers lazy
    // images there; explicitly request this fixture so we test decode geometry
    // rather than each engine's lazy-loading distance heuristic.
    await frame.locator("img").evaluate((image) => {
      image.loading = "eager";
    });
    decode();
    await page.waitForFunction(
      () =>
        document.querySelector('[data-ui="inline-image-frame"] img')
          ?.complete &&
        document.querySelector('[data-ui="inline-image-frame"] img')
          ?.naturalWidth > 0,
    );
    const frameAfter = await frame.boundingBox();
    const afterDecode = await offset();
    assert.ok(
      Math.abs(frameAfter.height - frameBefore.height) < 1,
      "Image decode changed frame height",
    );
    assert.ok(
      Math.abs(afterInsert - before) <= 2 &&
        Math.abs(afterDecode - before) <= 2,
      "Image insertion or decode moved the reading position",
    );
    await page.getByRole("button", { name: "Append output" }).click();
    await page.waitForTimeout(100);
    assert.ok(
      Math.abs((await offset()) - before) <= 2,
      "Output stole reading position",
    );
    await page.getByRole("button", { name: "Latest", exact: true }).click();
    await page.getByRole("button", { name: "Append output" }).click();
    await page.waitForTimeout(100);
    const bottomGap = await surface.evaluate(
      (e) => e.scrollHeight - e.clientHeight - e.scrollTop,
    );
    assert.ok(
      Math.abs(bottomGap) < 2,
      `Output follow lagged by ${bottomGap}px`,
    );
    assert.equal(
      await surface.evaluate((e) => e === window.scrollIdentity),
      true,
      "Transcript remounted",
    );
    await page.getByRole("button", { name: "Toggle panel" }).click();
    await page.waitForTimeout(450);
    await page.screenshot({ path: "/tmp/rift-scroll-layout-verified.png" });
    console.log(
      JSON.stringify(
        {
          passed: true,
          engine,
          viewport,
          before,
          afterOpen,
          afterClose,
          animationDrift,
          afterInsert,
          afterDecode,
          imageHeightBefore: frameBefore.height,
          imageHeightAfter: frameAfter.height,
          bottomGap,
          transcriptRetained: true,
        },
        null,
        2,
      ),
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
