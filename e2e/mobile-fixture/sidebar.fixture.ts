import { expect, test, type Page } from "@playwright/test";
async function sampleRows(page: Page, path: string) {
  const points = await page
    .locator('[data-testid^="chat-item-"]')
    .evaluateAll((rows) =>
      rows.map((row) => {
        const rect = row.getBoundingClientRect();
        return {
          id: row.getAttribute("data-testid"),
          x: Math.round(rect.left + 5),
          y: Math.round(rect.top + rect.height / 2),
          active: row.getAttribute("data-active"),
          background: getComputedStyle(row).backgroundColor,
        };
      }),
    );
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .map((animation) => animation.finished.catch(() => {})),
    ),
  );
  const png = await page.screenshot({ path, animations: "allow" });
  return page.evaluate(
    async ({ image, points }) => {
      const img = new Image();
      img.src = image;
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const context = canvas.getContext("2d")!;
      context.drawImage(img, 0, 0);
      return points.map((point) => ({
        ...point,
        pixel: Array.from(context.getImageData(point.x, point.y, 1, 1).data),
      }));
    },
    { image: `data:image/png;base64,${png.toString("base64")}`, points },
  );
}
const difference = (a: number[], b: number[]) =>
  Math.max(...a.map((v, i) => Math.abs(v - b[i])));
for (const theme of ["light", "dark"]) {
  test(`actual recent row selection paints the new pathname in ${theme}`, async ({
    page,
  }, info) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/*", (route) =>
      new URL(route.request().url()).origin === "http://127.0.0.1:3038"
        ? route.continue()
        : route.abort(),
    );
    await page.goto(`/c/chat-0?theme=${theme}`);
    await expect(page.getByTestId("chat-item-chat-0")).toHaveAttribute(
      "data-active",
      "true",
    );
    await page.mouse.move(800, 50);
    const initial = await sampleRows(page, info.outputPath("initial.png"));
    const selected = initial[0].pixel;
    const idle = initial[1].pixel;
    expect(difference(selected, idle)).toBeGreaterThan(4);
    for (const [step, chat] of [1, 2, 0, 9, 1].entries()) {
      await page.getByTestId(`chat-item-chat-${chat}`).click();
      await page.mouse.move(800, 50);
      await expect(page).toHaveURL(`/c/chat-${chat}`);
      await expect(page.getByTestId("current-route")).toHaveText(
        `/c/chat-${chat}`,
      );
      await expect(
        page.locator('[data-testid^="chat-item-"][data-active="true"]'),
      ).toHaveCount(1);
      await expect(page.getByTestId(`chat-item-chat-${chat}`)).toHaveAttribute(
        "aria-current",
        "page",
      );
      const pixels = await sampleRows(
        page,
        info.outputPath(`selection-${step}.png`),
      );
      await info.attach(`selection-${step}`, {
        body: JSON.stringify(pixels),
        contentType: "application/json",
      });
      for (let index = 0; index < pixels.length; index++) {
        expect(pixels[index].active).toBe(index === chat ? "true" : "false");
        expect(
          difference(pixels[index].pixel, index === chat ? selected : idle),
        ).toBeLessThan(3);
      }
    }
    await page.getByRole("button", { name: "Toggle sidebar" }).click();
    await page.getByRole("button", { name: "Toggle sidebar" }).click();
    await expect(page.getByTestId("chat-item-chat-1")).toHaveAttribute(
      "data-active",
      "true",
    );
    expect(errors).toEqual([]);
  });
}
