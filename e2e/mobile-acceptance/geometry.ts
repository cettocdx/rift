import { expect, type Locator, type Page } from "@playwright/test";

export type ControlGeometry = {
  name: string;
  rect: { x: number; y: number; width: number; height: number };
  viewport: { x: number; y: number; width: number; height: number };
  clippedBy: string[];
  coveredPoints: number;
  disabled: boolean;
  coarsePointer: boolean;
};

/** Reveal through user-scrollable ancestors only: overflow:hidden is not a way in. */
export async function inspectControl(
  locator: Locator,
  name: string,
  reveal = false,
): Promise<ControlGeometry> {
  await expect(locator, `${name} exists and is visible`).toBeVisible();
  if (reveal) {
    await locator.evaluate((element) => {
      for (
        let parent = element.parentElement;
        parent;
        parent = parent.parentElement
      ) {
        const style = getComputedStyle(parent);
        const r = element.getBoundingClientRect();
        const p = parent.getBoundingClientRect();
        if (
          /(auto|scroll)/.test(style.overflowY) &&
          (r.top < p.top || r.bottom > p.bottom)
        )
          parent.scrollTop += r.top + r.height / 2 - (p.top + p.height / 2);
        if (
          /(auto|scroll)/.test(style.overflowX) &&
          (r.left < p.left || r.right > p.right)
        )
          parent.scrollLeft += r.left + r.width / 2 - (p.left + p.width / 2);
      }
      const r = element.getBoundingClientRect();
      if (
        document.scrollingElement &&
        document.documentElement.scrollHeight > innerHeight &&
        !/hidden|clip/.test(
          getComputedStyle(document.documentElement).overflowY,
        )
      )
        window.scrollBy(
          0,
          r.top < 0 || r.bottom > innerHeight
            ? r.top - innerHeight / 2 + r.height / 2
            : 0,
        );
    });
  }
  const measured = await locator.evaluate((element) => {
    const r = element.getBoundingClientRect();
    const v = visualViewport;
    const viewport = {
      x: v?.offsetLeft ?? 0,
      y: v?.offsetTop ?? 0,
      width: v?.width ?? innerWidth,
      height: v?.height ?? innerHeight,
    };
    const clippedBy: string[] = [];
    const epsilon = 1.5;
    for (
      let parent = element.parentElement;
      parent;
      parent = parent.parentElement
    ) {
      const style = getComputedStyle(parent);
      const p = parent.getBoundingClientRect();
      const left = p.left + parent.clientLeft;
      const top = p.top + parent.clientTop;
      if (
        (/(hidden|clip|auto|scroll)/.test(style.overflowX) &&
          (r.left < left - epsilon ||
            r.right > left + parent.clientWidth + epsilon)) ||
        (/(hidden|clip|auto|scroll)/.test(style.overflowY) &&
          (r.top < top - epsilon ||
            r.bottom > top + parent.clientHeight + epsilon))
      ) {
        clippedBy.push(
          parent.id ||
            parent.getAttribute("aria-label") ||
            parent.tagName.toLowerCase(),
        );
      }
    }
    const points = [
      [0.5, 0.5],
      [0.15, 0.2],
      [0.85, 0.2],
      [0.15, 0.8],
      [0.85, 0.8],
    ];
    const disabled = element.matches(":disabled, [aria-disabled='true']");
    const coveredPoints = points.filter(([x, y]) => {
      const hit = document.elementFromPoint(
        r.left + r.width * x,
        r.top + r.height * y,
      );
      return !hit || (hit !== element && !element.contains(hit));
    }).length;
    return {
      rect: { x: r.x, y: r.y, width: r.width, height: r.height },
      viewport,
      clippedBy,
      coveredPoints,
      disabled,
      coarsePointer: matchMedia("(pointer: coarse)").matches,
    };
  });
  const { rect: r, viewport: v } = measured;
  expect.soft(r.width, `${name}: nonzero width`).toBeGreaterThan(0);
  expect.soft(r.height, `${name}: nonzero height`).toBeGreaterThan(0);
  if (measured.coarsePointer) {
    expect
      .soft(r.width, `${name}: touch target width must be at least 44px`)
      .toBeGreaterThanOrEqual(44);
    expect
      .soft(r.height, `${name}: touch target height must be at least 44px`)
      .toBeGreaterThanOrEqual(44);
  }
  expect
    .soft(r.x, `${name}: left viewport edge`)
    .toBeGreaterThanOrEqual(v.x - 1.5);
  expect
    .soft(r.y, `${name}: top viewport edge`)
    .toBeGreaterThanOrEqual(v.y - 1.5);
  expect
    .soft(r.x + r.width, `${name}: right viewport edge`)
    .toBeLessThanOrEqual(v.x + v.width + 1.5);
  expect
    .soft(r.y + r.height, `${name}: bottom viewport edge`)
    .toBeLessThanOrEqual(v.y + v.height + 1.5);
  expect.soft(measured.clippedBy, `${name}: clipping ancestors`).toEqual([]);
  if (!measured.disabled)
    expect
      .soft(
        measured.coveredPoints,
        `${name}: overlay hit testing at five points`,
      )
      .toBe(0);
  return { name, ...measured };
}

export async function inspectScrollRegions(page: Page) {
  const regions = await page.locator("body").evaluate((body) => {
    return [...body.querySelectorAll<HTMLElement>("*")]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return (
          r.width > 0 &&
          r.height > 0 &&
          /auto|scroll/.test(getComputedStyle(el).overflowY) &&
          el.scrollHeight > el.clientHeight + 2
        );
      })
      .map((el) => {
        const before = el.scrollTop;
        const max = el.scrollHeight - el.clientHeight;
        el.scrollTop = max;
        const reached = el.scrollTop;
        el.scrollTop = before;
        return {
          element:
            el.id || el.getAttribute("aria-label") || el.tagName.toLowerCase(),
          max,
          reached,
        };
      });
  });
  for (const region of regions)
    expect
      .soft(
        region.reached,
        `${region.element}: scroll content can reach its end`,
      )
      .toBeGreaterThanOrEqual(region.max - 2);
  const viewport = await page.evaluate(() => ({
    width: innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    scale: visualViewport?.scale ?? 1,
  }));
  expect
    .soft(viewport.documentWidth, "Document must not widen the mobile viewport")
    .toBeLessThanOrEqual(viewport.width + 1);
  expect
    .soft(viewport.scale, "Mobile page uses an unscaled viewport")
    .toBeCloseTo(1, 2);
  return { viewport, regions };
}
