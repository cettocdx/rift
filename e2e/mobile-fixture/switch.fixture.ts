import { expect, test, type Locator } from "@playwright/test";
async function visualTrack(control: Locator) {
  const track = control.locator('[data-slot="switch-track"]');
  return (await track.count()) ? track : control;
}
for (const height of [844, 500])
  test(`switch padding toggles once; disabled and adjacent targets stay isolated at ${height}px height`, async ({
    page,
  }, info) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/*", (route) => {
      if (
        new URL(route.request().url()).origin !== "http://127.0.0.1:3040" ||
        route.request().method() !== "GET"
      ) {
        errors.push("Unexpected fixture request");
        return route.abort();
      }
      return route.continue();
    });
    await page.setViewportSize({ width: page.viewportSize()!.width, height });
    await page.goto("/lab/switch");
    const coarse = await page.evaluate(
      () => matchMedia("(pointer: coarse)").matches,
    );
    expect(coarse).toBe(Boolean(info.project.use.hasTouch));
    const activate = async (x: number, y: number) =>
      coarse ? page.touchscreen.tap(x, y) : page.mouse.click(x, y);
    const notes = page.getByRole("switch", { name: "Toggle notes" });
    await expect(notes).toBeEnabled();
    const track = await visualTrack(notes);
    const box = (await track.boundingBox())!;
    expect(box.width, "visible track width").toBeCloseTo(32, 0);
    expect(box.height, "visible track height").toBeCloseTo(18.4, 0);
    const rootBox = (await notes.boundingBox())!;
    expect(rootBox.width).toBeCloseTo(coarse ? 44 : 32, 0);
    expect(rootBox.height).toBeCloseTo(coarse ? 44 : 18.4, 0);
    const initialTrackColor = await track.evaluate(
      (el) => getComputedStyle(el).backgroundColor,
    );
    const thumb = notes.locator('[data-slot="switch-thumb"]');
    const initialThumbX = (await thumb.boundingBox())!.x;
    const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const hitPoints = coarse
      ? [
          { x: center.x - 20, y: center.y },
          { x: center.x + 20, y: center.y },
          { x: center.x, y: center.y - 20 },
          { x: center.x, y: center.y + 20 },
        ]
      : [center];
    for (const [i, point] of hitPoints.entries()) {
      expect(
        await notes.evaluate(
          (el, p) => el.contains(document.elementFromPoint(p.x, p.y)),
          point,
        ),
        "44px padding must hit the switch",
      ).toBe(true);
      await activate(point.x, point.y);
      await expect(page.getByLabel("Notes changes")).toHaveText(String(i + 1));
      await expect(notes).toHaveAttribute("aria-checked", String(i % 2 !== 0));
      await expect(notes).toBeEnabled();
      if (i === 0) {
        await expect
          .poll(() =>
            track.evaluate((el) => getComputedStyle(el).backgroundColor),
          )
          .not.toBe(initialTrackColor);
        await expect
          .poll(async () => initialThumbX - (await thumb.boundingBox())!.x)
          .toBeCloseTo(14, 0);
      }
    }
    const labelled = page.getByRole("switch", {
      name: "Labelled setting",
      exact: true,
    });
    await labelled.scrollIntoViewIfNeeded();
    const labelBox = (await (await visualTrack(labelled)).boundingBox())!;
    await activate(
      labelBox.x + labelBox.width / 2,
      labelBox.y + labelBox.height / 2 + (coarse ? 20 : 0),
    );
    await expect(page.getByLabel("Label changes")).toHaveText("1");
    await expect(labelled).toBeChecked();
    const disabled = page.getByRole("switch", { name: "Disabled setting" });
    await expect(disabled).toBeDisabled();
    await disabled.scrollIntoViewIfNeeded();
    const disabledBox = (await (await visualTrack(disabled)).boundingBox())!;
    await activate(
      disabledBox.x + disabledBox.width / 2 + (coarse ? 20 : 0),
      disabledBox.y + disabledBox.height / 2,
    );
    await expect(disabled).toBeChecked();
    await expect(page.getByLabel("Neighbor changes")).toHaveText("0");
    const neighbor = page.getByRole("button", { name: "Neighbor action" });
    const neighborBox = (await neighbor.boundingBox())!;
    const disabledRoot = (await disabled.boundingBox())!;
    expect(disabledRoot.x + disabledRoot.width).toBeLessThanOrEqual(
      neighborBox.x,
    );
    await neighbor.click();
    await expect(page.getByLabel("Neighbor changes")).toHaveText("1");
    const compact = page.getByRole("switch", { name: "Compact setting" });
    await compact.scrollIntoViewIfNeeded();
    const compactRoot = (await compact.boundingBox())!;
    const footer = (await page
      .locator('[data-fixture="compact-footer"]')
      .boundingBox())!;
    const details = (await page
      .getByRole("button", { name: "Card details" })
      .boundingBox())!;
    expect(
      compactRoot.y,
      "switch cannot overlap card's other action",
    ).toBeGreaterThanOrEqual(details.y + details.height);
    expect(compactRoot.y).toBeGreaterThanOrEqual(footer.y);
    expect(compactRoot.y + compactRoot.height).toBeLessThanOrEqual(
      footer.y + footer.height,
    );
    const compactPoint = {
      x: compactRoot.x + compactRoot.width / 2,
      y: compactRoot.y + compactRoot.height / 2 - (coarse ? 20 : 0),
    };
    expect(compactPoint.y).toBeGreaterThanOrEqual(0);
    expect(compactPoint.y).toBeLessThan(height);
    expect(
      await compact.evaluate(
        (el, p) => el.contains(document.elementFromPoint(p.x, p.y)),
        compactPoint,
      ),
    ).toBe(true);
    await activate(compactPoint.x, compactPoint.y);
    await expect(page.getByLabel("Compact changes")).toHaveText("1");
    await expect(page.getByLabel("Neighbor changes")).toHaveText("1");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await info.attach("switch-layout", {
      body: await page.screenshot(),
      contentType: "image/png",
    });
    await info.attach("switch-geometry", {
      body: JSON.stringify({
        coarse,
        track: box,
        root: rootBox,
        compactRoot,
        footer,
        height,
      }),
      contentType: "application/json",
    });
    expect(errors).toEqual([]);
  });
