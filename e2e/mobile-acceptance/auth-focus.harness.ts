import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { compile } from "tailwindcss";

test("the production auth field classes render a visible keyboard focus outline", async ({
  page,
}) => {
  // Compile the actual shared input classes with the installed Tailwind version.
  // This isolates CSS rendering, not authentication or live-route acceptance.
  const source = readFileSync(
    path.resolve(__dirname, "../../app/components/AuthForm.tsx"),
    "utf8",
  );
  const classes = source.match(/const inputCls\s*=\s*"([^"]+)";/)?.[1];
  expect(
    classes,
    "AuthForm defines its shared input class string",
  ).toBeTruthy();
  const compiler = await compile("@tailwind utilities;");
  const css = compiler.build(classes!.split(/\s+/));
  await page.setContent(
    `<style>${css}</style><input aria-label="Auth field" style="--pa-ink: #000; --pa-ground: #fff">`,
  );
  const input = page.getByRole("textbox", { name: "Auth field" });
  await input.evaluate((element, value) => {
    element.setAttribute("class", value);
  }, classes!);
  await page.keyboard.press("Tab");
  await expect(input).toBeFocused();
  await expect
    .poll(() =>
      input.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          style: style.outlineStyle,
          width: style.outlineWidth,
          color: style.outlineColor,
        };
      }),
    )
    .toEqual({ style: "solid", width: "2px", color: "rgb(0, 0, 0)" });
});
