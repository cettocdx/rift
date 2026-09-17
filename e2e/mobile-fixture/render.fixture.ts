import { test, expect } from "@playwright/test";
import { readRenderDiagnostics } from "./render-diagnostics";
for (const theme of ["light", "dark"])
  test(`real dock and sidebar with read-only diagnostics in ${theme}`, async ({
    page,
  }, info) => {
    const errors: string[] = [];
    const external: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/*", (route) => {
      if (
        new URL(route.request().url()).origin !== "http://127.0.0.1:3038" ||
        /\/api\//.test(route.request().url())
      ) {
        external.push(route.request().url());
        return route.abort();
      }
      return route.continue();
    });
    await page.goto(`/c/chat-0?theme=${theme}`);
    const pane = page.locator("[data-rift-tool-pane]");
    await expect(page.getByTestId("chat-item-chat-0")).toHaveAttribute(
      "data-active",
      "true",
    );
    await expect(pane).toHaveAttribute("data-visible", "false");
    await page
      .getByRole("button", { name: "Open Activity", exact: true })
      .click();
    await expect(
      page.getByText("No activity yet", { exact: true }),
    ).toBeVisible();
    await expect(pane).toHaveCSS("opacity", "1");
    await expect(pane).toHaveCSS("visibility", "visible");
    // Inspect the authentic reveal rule, without disabling or completing animations.
    expect(
      await pane.evaluate((node) => getComputedStyle(node).animationName),
    ).toContain("dockReveal");
    const before = await pane.evaluate((node) => node.getAttribute("style"));
    const record = await page.evaluate(readRenderDiagnostics);
    expect(record.nodes.pane?.style.animationName).toContain("dockReveal");
    expect(record.nodes.row?.attributes["aria-current"]).toBe("page");
    expect(record.nodes.body?.style.display).toBe("flex");
    expect(record.nodes.rowWrapper?.style.contentVisibility).toBe("auto");
    expect(
      Object.keys(record.nodes).filter((key) => key.startsWith("sidebarRow")),
    ).toHaveLength(10);
    const mutations = await page.evaluate(async (readSource) => {
      // Observe real nodes while invoking the visible diagnostic control. Its own output lives elsewhere.
      const changed: string[] = [];
      const observer = new MutationObserver((records) =>
        changed.push(
          ...records.map((record) => record.attributeName ?? record.type),
        ),
      );
      document
        .querySelectorAll("[data-rift-tool-pane], [data-rift-sidebar-panel]")
        .forEach((node) =>
          observer.observe(node, {
            attributes: true,
            subtree: true,
            childList: true,
          }),
        );
      document.querySelectorAll("button").forEach((button) => {
        if (button.textContent === readSource) button.click();
      });
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
      observer.disconnect();
      return changed;
    }, "Read render diagnostics");
    expect(mutations).toEqual([]);
    const visibleRecord = JSON.parse(
      (await page.getByTestId("render-diagnostics").textContent())!,
    );
    expect(visibleRecord.nodes.pane.style.opacity).toBe("1");
    await expect(page.getByTestId("render-node-pane")).toContainText(
      "opacity=1; display=block; visibility=visible",
    );
    await expect(page.getByTestId("render-animation-pane")).toContainText(
      "dockReveal",
    );
    await expect(page.getByTestId("render-node-rowWrapper")).toContainText(
      "contentVisibility=auto",
    );
    await expect(page.getByTestId("render-selected")).toContainText(
      "selected: chat-item-chat-0",
    );
    expect(
      await page.locator('[data-testid="render-summary"] p').allTextContents(),
    ).toHaveLength(13);
    for (const text of await page
      .locator('[data-testid="render-summary"] p')
      .allTextContents())
      expect(text.length).toBeLessThan(300);
    await expect(page.getByTestId("render-diagnostics")).not.toBeVisible();
    await page.getByText("Full diagnostic JSON", { exact: true }).click();
    await expect(page.getByTestId("render-diagnostics")).toBeVisible();
    await page.getByText("Full diagnostic JSON", { exact: true }).click();
    expect(visibleRecord.nodes.row.attributes["data-active"]).toBe("true");
    expect(await pane.getAttribute("style")).toBe(before);
    await page.screenshot({
      path: info.outputPath("activity-open.png"),
      animations: "allow",
    });
    await page
      .getByRole("button", { name: "Hide workspace panel", exact: true })
      .click();
    await expect(pane).toHaveAttribute("data-visible", "false");
    await expect(pane).toHaveCSS("visibility", "hidden");
    await page.getByTestId("chat-item-chat-1").click();
    await expect(page.getByTestId("current-route")).toHaveText("/c/chat-1");
    await expect(page.getByTestId("chat-item-chat-1")).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(page.getByTestId("chat-item-chat-0")).toHaveAttribute(
      "data-active",
      "false",
    );
    await page
      .getByRole("button", { name: "Open Activity", exact: true })
      .click();
    await expect(
      page.getByText("No activity yet", { exact: true }),
    ).toBeVisible();
    await expect(pane).toHaveCSS("opacity", "1");
    await page
      .getByRole("button", { name: "Read render diagnostics", exact: true })
      .click();
    const reopened = JSON.parse(
      (await page.getByTestId("render-diagnostics").textContent())!,
    );
    expect(reopened.path).toBe("/c/chat-1");
    expect(reopened.nodes.row.attributes["aria-current"]).toBe("page");
    await info.attach("read-only-render-snapshot", {
      body: JSON.stringify(reopened, null, 2),
      contentType: "application/json",
    });
    await page.screenshot({
      path: info.outputPath("activity-reopened.png"),
      animations: "allow",
    });
    expect(external).toEqual([]);
    expect(errors).toEqual([]);
  });
