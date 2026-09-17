import { isKnownBrowserDiagnostic } from "../mobile-acceptance/browser-diagnostics";
import { test, expect } from "@playwright/test";
import {
  inspectControl,
  inspectScrollRegions,
  type ControlGeometry,
} from "../mobile-acceptance/geometry";

for (const path of ["/login", "/signup"] as const) {
  test(`${path}: anonymous mobile controls and keyboard focus`, async ({
    page,
    context,
    browserName,
    baseURL,
  }, info) => {
    const errors: string[] = [];
    const browserDiagnostics: string[] = [];
    const writes: string[] = [];
    const geometry: ControlGeometry[] = [];
    const focus: unknown[] = [];
    let viewport: Awaited<ReturnType<typeof inspectScrollRegions>> | undefined;
    const capture = async (name: string) => {
      const output = info.outputPath(`${name}.png`);
      await page.screenshot({ path: output });
      await info.attach(name, { path: output, contentType: "image/png" });
    };
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        if (isKnownBrowserDiagnostic(browserName, msg.text()))
          browserDiagnostics.push(msg.text());
        else errors.push(msg.text());
      }
    });
    page.on("pageerror", (error) => errors.push(error.message));
    await context.route("**/api/**", async (route) => {
      if (!["GET", "HEAD", "OPTIONS"].includes(route.request().method())) {
        writes.push(
          `${route.request().method()} ${new URL(route.request().url()).pathname}`,
        );
        await route.abort("blockedbyclient");
      } else await route.continue();
    });
    try {
      const response = await page.goto(path, { waitUntil: "domcontentloaded" });
      expect(response?.status()).toBe(200);
      await expect(page).toHaveURL(new URL(path, baseURL!).href);
      await expect(
        page.getByRole("heading", {
          name: path === "/login" ? "Welcome back" : "Create your account",
          exact: true,
        }),
      ).toBeVisible();
      await expect(page.locator('[data-rift-route-shell="chat"]')).toHaveCount(
        0,
      );
      const controls = [
        [
          "RIFT home",
          page.getByRole("link", { name: "RIFT home", exact: true }),
        ],
        [
          "Back home",
          page.getByRole("link", { name: "Back home", exact: true }),
        ],
        [
          "Continue with Google",
          page.getByRole("button", {
            name: "Continue with Google",
            exact: true,
          }),
        ],
        ["Email", page.getByLabel("Email", { exact: true })],
        ["Password", page.getByLabel("Password", { exact: true })],
        [
          "Submit (not activated)",
          page.getByRole("button", {
            name: path === "/login" ? "Sign in" : "Create account",
            exact: true,
          }),
        ],
        [
          "Inline auth-switch link",
          page.getByRole("link", {
            name: path === "/login" ? "Create an account" : "Sign in",
            exact: true,
          }),
        ],
        ["Terms", page.getByRole("link", { name: "Terms", exact: true })],
        ["Privacy", page.getByRole("link", { name: "Privacy", exact: true })],
      ] as const;
      await capture("initial-viewport");
      for (const [name, locator] of controls) {
        const measured = await inspectControl(locator, name, false);
        geometry.push(measured);
        // The auth-switch link is inside a sentence and uses the inline exception.
        if (name !== "Inline auth-switch link") {
          expect
            .soft(measured.rect.height, `${name} hit target height`)
            .toBeGreaterThanOrEqual(24);
          expect
            .soft(measured.rect.width, `${name} hit target width`)
            .toBeGreaterThanOrEqual(24);
        }
        await expect(locator).toBeEnabled();
      }
      for (const [name, locator] of controls) {
        await page.keyboard.press(browserName === "webkit" ? "Alt+Tab" : "Tab");
        await expect(
          locator,
          `${name} natural forward Tab order`,
        ).toBeFocused();
        // Wait for the existing focus-color transition before measuring it.
        await expect
          .poll(() =>
            locator.evaluate((el) => getComputedStyle(el).outlineColor),
          )
          .toBe("rgb(237, 237, 237)");
        const style = await locator.evaluate((el) => {
          const style = getComputedStyle(el);
          return {
            outlineWidth: style.outlineWidth,
            outlineStyle: style.outlineStyle,
            outlineColor: style.outlineColor,
            boxShadow: style.boxShadow,
            fontSize: style.fontSize,
            focusVisible: el.matches(":focus-visible"),
          };
        });
        focus.push({ name, ...style });
        expect.soft(style.focusVisible, `${name} focus visible`).toBe(true);
        expect
          .soft(parseFloat(style.outlineWidth), `${name} visible outline width`)
          .toBeGreaterThanOrEqual(2);
        expect
          .soft(style.outlineStyle, `${name} visible outline style`)
          .not.toBe("none");
        geometry.push(await inspectControl(locator, `${name} focused`));
        if (name === "Email" || name === "Password") {
          expect(
            parseFloat(style.fontSize),
            `${name} avoids iOS focus zoom`,
          ).toBeGreaterThanOrEqual(16);
        }
        if (name === "Email") await capture("email-keyboard-focus");
      }
      for (let index = controls.length - 2; index >= 0; index--) {
        await page.keyboard.press(
          browserName === "webkit" ? "Alt+Shift+Tab" : "Shift+Tab",
        );
        await expect(
          controls[index][1],
          `${controls[index][0]} reverse Tab order`,
        ).toBeFocused();
      }
      viewport = await inspectScrollRegions(page);
      // Shrink the actual browser viewport to expose scroll/focus clipping.
      // This is reduced viewport coverage, not an emulated OS software keyboard.
      const width = page.viewportSize()!.width;
      await page.setViewportSize({ width, height: 500 });
      await page.getByLabel("Password", { exact: true }).focus();
      geometry.push(
        await inspectControl(
          page.getByLabel("Password", { exact: true }),
          "Password in 500px viewport",
          true,
        ),
      );
      await capture("short-viewport-password-focus");
      expect.soft(errors, "No page/console errors").toEqual([]);
      expect
        .soft(writes, "No credential, signup, or other API submission")
        .toEqual([]);
    } finally {
      await info.attach("measurements.json", {
        body: JSON.stringify({ geometry, focus, viewport }, null, 2),
        contentType: "application/json",
      });
      await info.attach("errors-and-writes.json", {
        body: JSON.stringify({ errors, writes, browserDiagnostics }, null, 2),
        contentType: "application/json",
      });
      if (!page.isClosed()) await capture("final-viewport");
    }
  });
}
