import { test, expect } from "@playwright/test";
import { inspectControl } from "./geometry";

for (const touch of [true, false]) {
  test(`geometry rejects undersized controls only for coarse input: ${touch}`, async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: touch,
      hasTouch: touch,
    });
    try {
      const page = await context.newPage();
      await page.setContent(
        '<meta name="viewport" content="width=device-width,initial-scale=1"><button style="width:20px;height:20px;padding:0;border:0">+</button>',
      );
      expect(
        await page.evaluate(() => matchMedia("(pointer: coarse)").matches),
      ).toBe(touch);
      const measured = await inspectControl(
        page.getByRole("button"),
        "Compact action",
      );
      expect(measured.rect).toMatchObject({ width: 20, height: 20 });
      if (touch) {
        // Mark the case as expected to fail only after proving both failures
        // came from target sizing. Clipping/browser errors must still fail it.
        const errors = test.info().errors.map((error) => error.message);
        expect(errors).toHaveLength(2);
        expect(errors).toEqual(
          expect.arrayContaining([
            expect.stringContaining("touch target width must be at least 44px"),
            expect.stringContaining(
              "touch target height must be at least 44px",
            ),
          ]),
        );
        test.fail(
          true,
          "The two 44px target assertions must reject this control",
        );
      }
    } finally {
      await context.close();
    }
  });
}

test("a small glyph inside a real 44px touch button passes", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  try {
    const page = await context.newPage();
    await page.setContent(
      '<meta name="viewport" content="width=device-width,initial-scale=1"><button style="width:44px;height:44px;padding:0;border:0"><span style="font-size:14px">+</span></button>',
    );
    const measured = await inspectControl(
      page.getByRole("button"),
      "Touch action",
    );
    expect(measured.rect).toMatchObject({ width: 44, height: 44 });
  } finally {
    await context.close();
  }
});
