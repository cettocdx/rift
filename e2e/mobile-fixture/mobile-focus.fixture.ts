import { expect, test } from "@playwright/test";
import {
  APPEARANCE_BOOTSTRAP_SCRIPT,
  APPEARANCE_PRESETS,
  DEFAULT_APPEARANCE_CONFIG,
} from "../../lib/appearance/presets";

// A real browser cascade regression, not an iOS software-keyboard simulation.
// Uses the production composer plus globals -> workspace -> typography CSS.
for (const uiFontSize of [13, 18]) {
  test(`composer focus respects the mobile font floor and ${uiFontSize}px preference across themes`, async ({
    page,
  }, info) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/*", (route) =>
      new URL(route.request().url()).origin === "http://127.0.0.1:3038"
        ? route.continue()
        : route.abort(),
    );
    await page.goto("/lab/composer?compact");
    const draft = page.getByRole("textbox", { name: "Message RIFT" });
    await draft.fill("/fast Keep command paint aligned with my draft.");
    const coarse = await page.evaluate(
      () => matchMedia("(pointer: coarse)").matches,
    );
    expect(coarse).toBe(Boolean(info.project.use.hasTouch));
    const mobile = coarse && info.project.use.viewport!.width <= 767;
    const expectedSize = `${mobile ? Math.max(16, uiFontSize) : uiFontSize}px`;
    for (const preset of APPEARANCE_PRESETS) {
      for (const mode of ["light", "dark"] as const) {
        await test.step(`${preset.id} ${mode}`, async () => {
          await page.evaluate(
            ({ preset, mode, uiFontSize, defaults, bootstrap }) => {
              localStorage.setItem("theme", mode);
              localStorage.setItem(
                "rift:appearance:v1",
                JSON.stringify({
                  ...defaults,
                  uiFontSize,
                  light: { preset: preset.id, ...preset.light },
                  dark: { preset: preset.id, ...preset.dark },
                }),
              );
              document.documentElement.classList.toggle(
                "dark",
                mode === "dark",
              );
              document.documentElement.classList.toggle(
                "light",
                mode === "light",
              );
              // Execute the actual appearance bootstrap, including font scaling.
              new Function(bootstrap)();
            },
            {
              preset,
              mode,
              uiFontSize,
              defaults: DEFAULT_APPEARANCE_CONFIG,
              bootstrap: APPEARANCE_BOOTSTRAP_SCRIPT,
            },
          );
          await draft.focus();
          await expect(draft).toBeFocused();
          await expect(draft).toHaveCSS("font-size", expectedSize);
          await expect(
            page.locator('[data-ui="composer-command-paint"]'),
          ).toHaveCSS("font-size", expectedSize);
          await expect(draft).toHaveValue(
            "/fast Keep command paint aligned with my draft.",
          );
        });
      }
    }
    expect(errors).toEqual([]);
  });
}

test("all editable input types keep the iOS focus font floor", async ({
  page,
}, info) => {
  test.skip(
    !info.project.use.hasTouch || info.project.use.viewport!.width > 767,
  );
  await page.goto("/lab/composer?compact");
  await page.evaluate(() => {
    const form = document.createElement("form");
    for (const type of [
      null,
      "text",
      "search",
      "url",
      "tel",
      "email",
      "password",
      "number",
    ]) {
      const input = document.createElement("input");
      if (type) input.type = type;
      input.setAttribute("aria-label", `Focus ${type ?? "implicit text"}`);
      input.style.fontSize = "12px";
      form.append(input);
    }
    document.body.append(form);
  });
  for (const input of await page.locator('input[aria-label^="Focus "]').all()) {
    await input.focus();
    await expect(input).toBeFocused();
    await expect(input).toHaveCSS("font-size", "16px");
  }
});
