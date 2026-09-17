import { expect, test, type Locator } from "@playwright/test";
import { isKnownBrowserDiagnostic } from "../mobile-acceptance/browser-diagnostics";

async function measure(control: Locator) {
  await expect(control).toBeVisible();
  await control.evaluate(async (el) => {
    for (
      let parent: Element | null = el;
      parent;
      parent = parent.parentElement
    ) {
      await Promise.all(
        parent
          .getAnimations()
          .filter(
            (animation) =>
              animation.effect?.getTiming().iterations !== Infinity,
          )
          .map((animation) => animation.finished.catch(() => {})),
      );
    }
    el.scrollIntoView({ block: "center" });
  });
  return control.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return {
      x: r.x,
      y: r.y,
      width: r.width,
      height: r.height,
      hit: [
        [0.25, 0.25],
        [0.75, 0.25],
        [0.25, 0.75],
        [0.75, 0.75],
        [0.5, 0.5],
      ].every(([x, y]) =>
        el.contains(
          document.elementFromPoint(r.left + r.width * x, r.top + r.height * y),
        ),
      ),
      visible:
        r.left >= 0 &&
        r.right <= innerWidth &&
        r.top >= 0 &&
        r.bottom <= innerHeight,
    };
  });
}

for (const height of [844, 500])
  test(`Settings controls remain reachable at ${height}px height`, async ({
    page,
    browserName,
  }, info) => {
    const errors: string[] = [];
    const diagnostics: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (isKnownBrowserDiagnostic(browserName, message.text()))
        diagnostics.push(message.text());
      else if (message.type() === "error") errors.push(message.text());
    });
    await page.route("**/*", (route) => {
      if (
        new URL(route.request().url()).origin !== "http://127.0.0.1:3041" ||
        route.request().method() !== "GET"
      ) {
        errors.push("Unexpected request outside read-only settings fixture");
        return route.abort();
      }
      return route.continue();
    });
    await page.setViewportSize({ width: page.viewportSize()!.width, height });
    const coarse = Boolean(info.project.use.hasTouch);
    const measurements: Record<string, unknown> = {};
    async function check(label: string, control: Locator, fineHeight: number) {
      const box = await measure(control);
      measurements[label] = box;
      if (await control.isEnabled())
        expect(box.hit, `${label} must receive pointer input`).toBe(true);
      expect(box.visible, `${label} must be within viewport`).toBe(true);
      if (coarse) {
        expect
          .soft(box.height, `${label} coarse height`)
          .toBeGreaterThanOrEqual(44);
        expect
          .soft(box.width, `${label} coarse width`)
          .toBeGreaterThanOrEqual(44);
      } else
        expect(box.height, `${label} fine height stays unchanged`).toBeCloseTo(
          fineHeight,
          0,
        );
    }
    for (const section of ["api-keys", "account", "billing", "appearance"]) {
      await page.goto(`/lab/settings?section=${section}`);
      expect(
        JSON.parse(await page.getByLabel("Fixture calls").innerText())
          .forbidden,
      ).toBe(0);
      expect(
        await page.evaluate(() => matchMedia("(pointer: coarse)").matches),
      ).toBe(coarse);
      if (section === "api-keys") {
        await check(
          "Create key",
          page.getByRole("button", { name: "Create key", exact: true }),
          36,
        );
        await check(
          "Revoke",
          page.getByRole("button", { name: "Revoke", exact: true }),
          28,
        );
        await check(
          "Copy",
          page.getByRole("button", { name: "Copy", exact: true }).first(),
          26,
        );
        await check(
          "API key name",
          page.getByRole("textbox", { name: "API key name" }),
          page.viewportSize()!.width < 461 ? 26 : 36,
        );
        // Synthetic create callback only; the fixture cannot create a server key.
        await page
          .getByRole("button", { name: "Create key", exact: true })
          .click();
        await expect(page.getByLabel("Fixture calls")).toHaveText(
          '{"create":1,"clipboard":0,"revoke":0,"forbidden":0}',
        );
        await page
          .getByRole("button", { name: "Copy", exact: true })
          .first()
          .click();
        await expect(page.getByLabel("Fixture calls")).toHaveText(
          '{"create":1,"clipboard":1,"revoke":0,"forbidden":0}',
        );
        const revoke = page.getByRole("button", {
          name: "Revoke",
          exact: true,
        });
        // Real pointer activation then outside click must disarm on both engines.
        // A second first-click must only arm again, never invoke revoke.
        for (let attempt = 0; attempt < 2; attempt++) {
          if (coarse) await revoke.tap();
          else await revoke.click();
          await expect(
            page.getByRole("button", { name: "Confirm?", exact: true }),
          ).toBeVisible();
          const input = page.getByRole("textbox", { name: "API key name" });
          if (coarse) await input.tap();
          else await input.click();
          await expect(revoke).toBeVisible();
          await expect(page.getByLabel("Fixture calls")).toHaveText(
            '{"create":1,"clipboard":1,"revoke":0,"forbidden":0}',
          );
        }
        // Deliberate confirmation invokes one synthetic callback, never a server mutation.
        if (coarse) await revoke.tap();
        else await revoke.click();
        const confirmation = page.getByRole("button", {
          name: "Confirm?",
          exact: true,
        });
        if (coarse) await confirmation.tap();
        else await confirmation.click();
        await expect(page.getByLabel("Fixture calls")).toHaveText(
          '{"create":1,"clipboard":1,"revoke":1,"forbidden":0}',
        );
      } else if (section === "account") {
        await check(
          "Delete account",
          page.getByRole("button", { name: "Delete account", exact: true }),
          32,
        );
        await page
          .getByRole("button", { name: "Delete account", exact: true })
          .click();
        const dialog = page.getByRole("dialog");
        await expect(dialog).toBeVisible();
        await check(
          "Account dialog close",
          dialog.getByRole("button", { name: "Close", exact: true }),
          24,
        );
        const confirm = dialog.getByRole("button", {
          name: "Permanently delete my account",
        });
        await expect(confirm).toBeDisabled();
        await check("Disabled account confirmation", confirm, 36);
        await info.attach("account-dialog", {
          body: await page.screenshot({ animations: "disabled" }),
          contentType: "image/png",
        });
        await dialog
          .getByRole("button", { name: "Close", exact: true })
          .click();
        await expect(dialog).toBeHidden();
      } else if (section === "billing") {
        await check(
          "Add credits",
          page.getByRole("button", { name: "Add credits", exact: true }),
          32,
        );
        await page
          .getByRole("button", { name: "Add credits", exact: true })
          .click();
        const dialog = page.getByRole("dialog");
        await expect(dialog).toBeVisible();
        await check(
          "Credit purchase",
          dialog.getByRole("button", { name: /^Pay \$/ }),
          44,
        );
        const close = dialog.getByRole("button", {
          name: "Close credit purchase",
        });
        await check(
          "Credit dialog close",
          close,
          page.viewportSize()!.width < 768 ? 44 : 32,
        );
        await info.attach("credit-dialog", {
          body: await page.screenshot({ animations: "disabled" }),
          contentType: "image/png",
        });
        await close.click();
        await expect(dialog).toBeHidden();
      } else {
        const font = page.getByRole("combobox", {
          name: "UI font",
          exact: true,
        });
        await check("UI font", font, 28);
        await font.selectOption("geist");
        await expect(font).toHaveValue("geist");
        await check(
          "Code font",
          page.getByRole("combobox", { name: "Code font", exact: true }),
          28,
        );
      }
      expect(
        JSON.parse(await page.getByLabel("Fixture calls").innerText())
          .forbidden,
        `${section} must not invoke a protected operation`,
      ).toBe(0);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        `${section} overflow`,
      ).toBe(true);
      await info.attach(`settings-${section}`, {
        body: await page.screenshot({ animations: "disabled" }),
        contentType: "image/png",
      });
    }
    await info.attach("settings-targets", {
      body: JSON.stringify(measurements, null, 2),
      contentType: "application/json",
    });
    await info.attach("browser-diagnostics", {
      body: JSON.stringify(diagnostics),
      contentType: "application/json",
    });
    expect(errors).toEqual([]);
  });
