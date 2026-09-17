import {
  test as base,
  expect,
  type Locator,
  type Page,
  type TestInfo,
} from "@playwright/test";
import { isKnownBrowserDiagnostic } from "./browser-diagnostics";
import { installReadOnlyGuard } from "./read-only-guard";
import { waitForAgentsReady } from "./agents-readiness";
import { SETTINGS_SECTIONS } from "../../lib/settings/registry";
import {
  verifyAuthenticatedSession,
  type VerifiedTestSession,
} from "../fixtures/verify-authenticated-session";
import {
  inspectControl,
  inspectScrollRegions,
  type ControlGeometry,
} from "./geometry";

const test = base.extend<
  { _diagnostics: void },
  { _identity: VerifiedTestSession }
>({
  _identity: [
    async ({ browser }, use) => {
      const context = await browser.newContext({
        baseURL: process.env.MOBILE_ACCEPTANCE_BASE_URL!,
        storageState: process.env.MOBILE_ACCEPTANCE_STORAGE_STATE!,
      });
      let identity: VerifiedTestSession;
      try {
        identity = await verifyAuthenticatedSession(
          context,
          process.env.MOBILE_ACCEPTANCE_BASE_URL!,
          {
            email: process.env.MOBILE_ACCEPTANCE_EMAIL!,
          },
        );
      } finally {
        await context.close();
      }
      await use(identity);
    },
    { scope: "worker", auto: true },
  ],
  _diagnostics: [
    async ({ page, context, browserName, _identity }, use, testInfo) => {
      void _identity;
      const errors: string[] = [];
      const browserDiagnostics: string[] = [];
      const blocked: string[] = [];
      page.on("pageerror", (error) =>
        errors.push(`pageerror: ${error.message}`),
      );
      page.on("console", (message) => {
        if (message.type() === "error") {
          if (isKnownBrowserDiagnostic(browserName, message.text()))
            browserDiagnostics.push(message.text());
          else errors.push(`console: ${message.text()}`);
        }
      });
      await installReadOnlyGuard(
        context,
        process.env.MOBILE_ACCEPTANCE_BASE_URL!,
        process.env.NEXT_PUBLIC_CONVEX_URL!,
        blocked,
      );
      await use();
      await testInfo.attach("browser-diagnostics.json", {
        body: JSON.stringify(browserDiagnostics, null, 2),
        contentType: "application/json",
      });
      await testInfo.attach("console-errors.json", {
        body: JSON.stringify(errors, null, 2),
        contentType: "application/json",
      });
      await testInfo.attach("blocked-writes.json", {
        body: JSON.stringify(blocked, null, 2),
        contentType: "application/json",
      });
      if (!page.isClosed())
        await testInfo.attach("final-viewport", {
          body: await page.screenshot(),
          contentType: "image/png",
        });
      expect
        .soft(
          blocked,
          "A read-only visit must not try to submit an HTTP or Convex write",
        )
        .toEqual([]);
      expect
        .soft(errors, "No browser console errors or uncaught page errors")
        .toEqual([]);
    },
    { auto: true },
  ],
});

type RouteCase = {
  path: string;
  kind:
    | "composer"
    | "agents"
    | "plugins"
    | "runs"
    | "tasks"
    | "notebook"
    | "artifacts"
    | "settings-index"
    | "settings";
  title?: string;
};
const routes: RouteCase[] = [
  { path: "/", kind: "composer" },
  { path: "/agents", kind: "agents", title: "Bots" },
  { path: "/plugins", kind: "plugins" },
  { path: "/runs", kind: "runs", title: "Runs" },
  { path: "/tasks", kind: "tasks", title: "Tasks" },
  { path: "/notebook", kind: "notebook" },
  { path: "/artifacts", kind: "artifacts", title: "Artifacts" },
  { path: "/studio", kind: "composer" },
  { path: "/settings", kind: "settings-index", title: "Settings" },
  ...SETTINGS_SECTIONS.map((section) => ({
    path: `/settings/${section.id}`,
    kind: "settings" as const,
    title: section.label,
  })),
];

async function openAuthenticated(page: Page, path: string, notebook = false) {
  const response = await page.goto(path, { waitUntil: "domcontentloaded" });
  expect(
    response?.status(),
    "Route must load without an HTTP error",
  ).toBeLessThan(400);
  await expect(page).toHaveURL(
    (url) =>
      url.origin === new URL(process.env.MOBILE_ACCEPTANCE_BASE_URL!).origin &&
      url.pathname ===
        (notebook ? "/hack" : new URL(path, url.origin).pathname),
  );
  if (!notebook) {
    // This marker is mounted exclusively inside Convex's Authenticated boundary.
    await expect(page.locator('[data-rift-route-shell="chat"]')).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Open navigation", exact: true }),
    ).toBeVisible();
  }
  await expect(
    page.getByRole("heading", { name: /sign in to|log in to/i }),
  ).toHaveCount(0);
}

async function saveGeometry(
  page: Page,
  testInfo: TestInfo,
  controls: ControlGeometry[],
) {
  const scroll = await inspectScrollRegions(page);
  await testInfo.attach("geometry.json", {
    body: JSON.stringify({ controls, ...scroll }, null, 2),
    contentType: "application/json",
  });
}

async function inspectAll(
  locator: Locator,
  name: string,
  controls: ControlGeometry[],
  reveal = true,
) {
  await expect(locator.first(), `${name} has loaded`).toBeVisible();
  const count = await locator.count();
  expect(count, `${name} must contain real controls`).toBeGreaterThan(0);
  for (let index = 0; index < count; index++) {
    controls.push(
      await inspectControl(locator.nth(index), `${name} ${index + 1}`, reveal),
    );
  }
}

for (const route of routes) {
  test(`${route.path}: authenticated mobile viewport and controls`, async ({
    page,
    _identity,
  }, testInfo) => {
    await openAuthenticated(page, route.path, route.kind === "notebook");
    const controls: ControlGeometry[] = [];
    const check = async (locator: Locator, name: string, reveal = false) =>
      controls.push(await inspectControl(locator, name, reveal));
    if (route.kind !== "notebook")
      await check(
        page.getByRole("button", { name: "Open navigation", exact: true }),
        "Open navigation",
      );
    if (route.title)
      await expect(
        page.getByRole("heading", { name: route.title, exact: true, level: 1 }),
      ).toBeVisible();
    switch (route.kind) {
      case "composer":
        await check(page.getByTestId("chat-input"), "Message composer");
        await check(
          page.getByRole("button", {
            name:
              route.path === "/studio"
                ? "Start a new Studio creation"
                : "Start a new Build chat",
            exact: true,
          }),
          "New conversation control",
        );
        await check(
          page.getByRole("button", { name: "Upload files", exact: true }),
          "Upload files",
        );
        break;
      case "agents":
        await waitForAgentsReady(page);
        await check(
          page.getByRole("combobox", { name: "Project", exact: true }),
          "Project selector",
        );
        await check(
          page
            .getByRole("button", { name: "Create project", exact: true })
            .first(),
          "Create project",
        );
        break;
      case "plugins":
        await check(
          page.getByRole("textbox", { name: "Search plugins", exact: true }),
          "Search plugins",
        );
        await inspectAll(
          page.getByRole("tablist", { name: "Extensions" }).getByRole("tab"),
          "Extension tabs",
          controls,
        );
        break;
      case "runs":
        await expect(
          page.getByRole("status", { name: "Loading runs" }),
        ).toHaveCount(0);
        await inspectAll(
          page
            .getByRole("group", { name: "Filter runs by status" })
            .getByRole("button"),
          "Run filters",
          controls,
        );
        break;
      case "tasks":
        await expect(page.locator("#tasks-main")).toHaveAttribute(
          "aria-busy",
          "false",
        );
        await check(
          page.getByRole("button", { name: "Create task", exact: true }),
          "Create task",
        );
        await inspectAll(
          page
            .getByRole("group", { name: "Filter tasks", exact: true })
            .getByRole("button"),
          "Task filters",
          controls,
        );
        break;
      case "artifacts":
        await expect(
          page.getByRole("status", { name: "Loading artifacts" }),
        ).toHaveCount(0);
        await inspectAll(
          page
            .getByRole("group", { name: "Artifact filters" })
            .getByRole("button"),
          "Artifact filters",
          controls,
        );
        break;
      case "settings-index":
        await check(
          page.getByRole("searchbox", { name: "Search settings", exact: true }),
          "Search settings",
        );
        await check(page.getByTestId("settings-exit"), "Back to app");
        for (const section of SETTINGS_SECTIONS)
          await check(
            page.getByTestId(`settings-index-${section.id}`),
            section.label,
            true,
          );
        break;
      case "settings": {
        if (route.path === "/settings/account") {
          await expect(
            page
              .locator(".rift-settings-content")
              .getByText(_identity.email, { exact: true }),
          ).toBeVisible();
        }
        await check(
          page
            .locator("[data-rift-settings-shell]")
            .getByRole("link", { name: "Settings", exact: true }),
          "Back to settings",
        );
        // All rendered controls, including destructive buttons, are measured
        // without clicking, focusing, filling, toggling, or submitting them.
        await inspectAll(
          page
            .locator(".rift-settings-content")
            .locator(
              'button:visible, input:not([type="hidden"]):visible, textarea:visible, select:visible, a[href]:visible, [role="switch"]:visible',
            ),
          "Settings controls",
          controls,
        );
        break;
      }
      case "notebook": {
        const gate = page.getByRole("heading", {
          name: "RIFT Max required",
          exact: true,
        });
        const command = page.getByRole("textbox", {
          name: "Security agent command",
          exact: true,
        });
        await expect(gate.or(command)).toBeVisible();
        const gated = await gate.isVisible();
        testInfo.annotations.push({
          type: "notebook-destination",
          description: gated
            ? "Authenticated Max entitlement gate; workbench not covered for this account"
            : "Authenticated Hack Workbench",
        });
        if (gated) {
          await check(
            page.getByRole("link", { name: "Back to RIFT", exact: true }),
            "Back to RIFT",
            true,
          );
          await check(
            page.getByRole("link", { name: "Upgrade to Max", exact: true }),
            "Plan gate primary link (not activated)",
            true,
          );
        } else {
          await check(command, "Security command");
          await check(
            page.getByRole("link", {
              name: "Back to the RIFT app",
              exact: true,
            }),
            "Back to RIFT",
          );
          await check(
            page.getByRole("button", {
              name: "Send security request",
              exact: true,
            }),
            "Security send control (not activated)",
          );
        }
        break;
      }
    }
    await saveGeometry(page, testInfo, controls);
    await testInfo.attach("route-viewport", {
      body: await page.screenshot(),
      contentType: "image/png",
    });
  });
}

test("mobile navigation drawer exposes route links and closes", async ({
  page,
}, testInfo) => {
  await openAuthenticated(page, "/");
  await page
    .getByRole("button", { name: "Open navigation", exact: true })
    .click();
  const drawer = page.getByRole("dialog", { name: "Navigation", exact: true });
  await expect(drawer).toBeVisible();
  const controls: ControlGeometry[] = [];
  const more = drawer.getByTestId("sidebar-more-toggle");
  controls.push(await inspectControl(more, "More workspaces"));
  if ((await more.getAttribute("aria-expanded")) !== "true") await more.click();
  for (const name of [
    "Build",
    "Studio",
    "Agents",
    "Plugins",
    "Runs",
    "Tasks",
    "Artifacts",
  ]) {
    controls.push(
      await inspectControl(
        drawer.getByRole("button", { name, exact: true }),
        `${name} navigation`,
        true,
      ),
    );
  }
  controls.push(
    await inspectControl(
      drawer.getByRole("button", { name: "Close navigation", exact: true }),
      "Close navigation",
      true,
    ),
  );
  await testInfo.attach("navigation-drawer", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
  await saveGeometry(page, testInfo, controls);
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
  await inspectControl(
    page.getByRole("button", { name: "Open navigation", exact: true }),
    "Restored navigation trigger",
  );
});

for (const resource of ["CHAT", "RUN", "PROJECT"] as const) {
  test(`existing ${resource === "PROJECT" ? "project" : `completed ${resource.toLowerCase()}`} (externally supplied)`, async ({
    page,
  }, testInfo) => {
    const id = process.env[`MOBILE_ACCEPTANCE_${resource}_ID`];
    test.skip(
      !id,
      `No existing ${resource.toLowerCase()} ID supplied; no data is created`,
    );
    const encoded = encodeURIComponent(id!);
    const path =
      resource === "CHAT"
        ? `/c/${encoded}`
        : resource === "RUN"
          ? `/runs/${encoded}`
          : `/agents?project=${encoded}`;
    await openAuthenticated(page, path);
    const controls: ControlGeometry[] = [];
    if (resource === "CHAT") {
      await expect(page.getByTestId("assistant-message").first()).toBeVisible();
      await expect(
        page.getByRole("button", {
          name: /stop (generation|generating|response|run)/i,
        }),
      ).toHaveCount(0);
      controls.push(
        await inspectControl(
          page.getByTestId("chat-input"),
          "Completed chat composer",
        ),
      );
    } else if (resource === "RUN") {
      await expect(
        page.getByRole("heading", { name: "Run not found", exact: true }),
      ).toHaveCount(0);
      await expect(
        page.locator('[data-ui="run-status"][data-status="completed"]'),
      ).toBeVisible();
      await inspectAll(
        page
          .locator("main")
          .getByRole("link", { name: /Open conversation|Open Hack session/ }),
        "Run destination",
        controls,
      );
    } else {
      await waitForAgentsReady(page);
      const selector = page.getByRole("combobox", {
        name: "Project",
        exact: true,
      });
      await expect(selector).toHaveValue(id!);
      controls.push(
        await inspectControl(selector, "Existing project selector"),
      );
    }
    await saveGeometry(page, testInfo, controls);
  });
}
