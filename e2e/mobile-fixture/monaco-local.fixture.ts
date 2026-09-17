import { test, expect } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import path from "node:path";

const buildFixture = require("./workbench-file-build.cjs");
let server: Server;
let origin: string;

test.beforeAll(async () => {
  require("../../scripts/prepare-monaco-assets.cjs").prepareMonacoAssets();
  const fixture = await buildFixture({ realMonaco: true });
  const diffFixture = await buildFixture({
    realMonaco: true,
    entryPoint: path.resolve("e2e/mobile-fixture/monaco-diff-entry.tsx"),
  });
  const assets = path.resolve("public/vendor/monaco/0.55.1");
  server = createServer((req, res) => {
    const pathname = new URL(req.url!, "http://localhost").pathname;
    if (pathname === "/" || pathname === "/diff") {
      res.setHeader("Content-Type", "text/html");
      res.end(
        '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>'.replace(
          "/fixture.js",
          pathname === "/diff" ? "/diff.js" : "/fixture.js",
        ),
      );
    } else if (
      pathname === "/fixture.js" ||
      pathname === "/fixture.css" ||
      pathname === "/diff.js"
    ) {
      res.setHeader(
        "Content-Type",
        pathname.endsWith("js") ? "text/javascript" : "text/css",
      );
      res.end(
        pathname === "/diff.js"
          ? diffFixture.js
          : pathname.endsWith("js")
            ? fixture.js
            : fixture.css,
      );
    } else if (pathname.startsWith("/vendor/monaco/0.55.1/")) {
      const file = path.resolve(
        assets,
        decodeURIComponent(pathname.slice("/vendor/monaco/0.55.1/".length)),
      );
      if (!file.startsWith(assets + path.sep)) {
        res.writeHead(403);
        res.end();
        return;
      }
      try {
        const types: Record<string, string> = {
          ".js": "text/javascript",
          ".css": "text/css",
          ".json": "application/json",
          ".ttf": "font/ttf",
          ".woff": "font/woff",
          ".woff2": "font/woff2",
        };
        res.setHeader(
          "Content-Type",
          types[path.extname(file)] || "application/octet-stream",
        );
        res.end(readFileSync(file));
      } catch {
        res.writeHead(404);
        res.end();
      }
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
test.afterAll(async () => {
  if (server)
    await new Promise<void>((resolve) => server.close(() => resolve()));
});

test("diff-first initialization also uses only local Monaco assets", async ({
  page,
  context,
}, info) => {
  const errors: string[] = [];
  await context.route("**/*", (route) => {
    if (new URL(route.request().url()).origin !== origin) {
      errors.push("External request");
      return route.abort();
    }
    return route.continue();
  });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto(origin + "/diff");
  const diff = page.locator(".monaco-diff-editor");
  await expect(diff).toBeVisible({ timeout: 30_000 });
  await expect(diff.locator(".view-lines").first()).toContainText("before");
  await expect(diff.locator(".view-lines").last()).toContainText("after");
  await expect(diff.locator(".monaco-editor:not(.gutter)").first()).toHaveClass(
    /vs(\s|$)/,
  );
  await page.getByRole("button", { name: "Dark theme", exact: true }).click();
  await expect(diff.locator(".monaco-editor:not(.gutter)").first()).toHaveClass(
    /vs-dark/,
  );
  await page.getByRole("button", { name: "Light theme", exact: true }).click();
  await expect(diff.locator(".monaco-editor:not(.gutter)").first()).toHaveClass(
    /vs(\s|$)/,
  );
  if (info.project.use.isMobile) {
    for (const name of ["Diff", "Original", "Modified"]) {
      const box = await page
        .getByRole("tab", { name, exact: true })
        .boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(44);
    }
  }
  await page.getByRole("tab", { name: "Original", exact: true }).click();
  const original = page.locator('[data-ui="cursor-diff-view"] pre').first();
  await expect(original).toContainText("before");
  await expect(page.locator('[data-ui="cursor-diff-view"]')).toHaveCSS(
    "background-color",
    "rgb(252, 252, 252)",
  );
  await page.getByRole("tab", { name: "Modified", exact: true }).click();
  await expect(
    page.locator('[data-ui="cursor-diff-view"] pre').first(),
  ).toContainText("after");
  await page.getByRole("tab", { name: "Diff", exact: true }).click();
  await expect(diff).toBeVisible();
  const tablist = page.getByRole("tablist", { name: "Diff view mode" });
  const diffTab = tablist.getByRole("tab", { name: "Diff", exact: true });
  await diffTab.focus();
  for (const [key, name] of [
    ["ArrowRight", "Original"],
    ["End", "Modified"],
    ["ArrowRight", "Diff"],
    ["ArrowLeft", "Modified"],
    ["Home", "Diff"],
    ["ArrowLeft", "Modified"],
    ["ArrowLeft", "Original"],
  ]) {
    await page.keyboard.press(key);
    const activeTab = tablist.getByRole("tab", { name, exact: true });
    await expect(activeTab).toBeFocused();
    await expect(activeTab).toHaveAttribute("aria-selected", "true");
    await expect(tablist.locator('[tabindex="0"]')).toHaveCount(1);
    const panel = page.getByRole("tabpanel", { name, exact: true });
    await expect(panel).toBeVisible();
    await expect(activeTab).toHaveAttribute(
      "aria-controls",
      (await panel.getAttribute("id")) as string,
    );
    await expect(panel).toHaveAttribute(
      "aria-labelledby",
      (await activeTab.getAttribute("id")) as string,
    );
  }
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("tabpanel", { name: "Original", exact: true }),
  ).toBeFocused();
  await expect(diff).toHaveCount(1);
  await diffTab.click();
  await expect(diff).toBeVisible();
  expect(errors).toEqual([]);
  await page.screenshot({ path: info.outputPath("real-diff.png") });
  await page.getByRole("button", { name: "Close diff", exact: true }).click();
  await expect(diff).toHaveCount(0);
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  expect(errors).toEqual([]);
});

test("real Monaco loads, edits and saves with all external requests blocked", async ({
  page,
  context,
}, info) => {
  const external: string[] = [];
  const failures: string[] = [];
  const assets: string[] = [];
  page.on("pageerror", (error) => failures.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(message.text());
  });
  page.on("response", (response) => {
    if (response.status() >= 400)
      failures.push(`${response.status()} ${response.url()}`);
  });
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) {
      external.push(url.origin);
      return route.abort();
    }
    if (url.pathname.startsWith("/vendor/monaco/")) assets.push(url.pathname);
    return route.continue();
  });
  await page.goto(origin);
  const mobile = Boolean(info.project.use.isMobile);
  if (mobile)
    await page.getByRole("button", { name: "Files", exact: true }).tap();
  await page.getByRole("treeitem", { name: "hello.ts", exact: true }).click();
  const editor = page.locator(".monaco-editor").first();
  await expect(editor).toBeVisible({ timeout: 30_000 });
  await expect(editor.locator(".view-lines")).toContainText("greeting");
  const input = editor.getByRole("textbox", {
    name: "Editor content",
    exact: true,
  });
  await input.focus();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.insertText("export const offline = true;");
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("tab", { name: "hello.ts, unsaved changes" }),
  ).toBeVisible();
  if (mobile) {
    await page.getByRole("button", { name: "More workspace actions" }).tap();
    await page
      .getByRole("menuitem", { name: "Save active file", exact: true })
      .tap();
  } else
    await page
      .getByRole("button", { name: "Save active file", exact: true })
      .click();
  await expect(
    page.getByRole("tab", { name: "hello.ts", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => (window as any).workbenchFileEvidence.writes),
  ).toEqual([
    {
      path: "hello.ts",
      content: "export const offline = true;",
      expectedRevision: "revision-1",
    },
  ]);
  expect(assets.some((url) => url.endsWith("/loader.js"))).toBe(true);
  await expect.poll(() => page.workers().length).toBeGreaterThan(0);
  expect(external).toEqual([]);
  expect(failures).toEqual([]);
  await page.screenshot({ path: info.outputPath("real-editor.png") });
});

test("code actions preserve content, respond to parent wrapping and remain reachable", async ({
  page,
  browserName,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          (window as any).__copiedCode = value;
        },
      },
    });
  });
  await page.goto(`${origin}/diff?code`);
  const actions = page.getByRole("group", { name: "Code actions" });
  await expect(actions).toBeVisible();
  const code = page.locator("pre");
  const content = "  first\n" + "long ".repeat(80) + "\nlast\n";
  await expect(code).toHaveCSS("white-space", "pre-wrap");
  await page.getByRole("button", { name: "Parent wrap" }).click();
  await expect(code).toHaveCSS("white-space", "pre");
  const wrap = page.getByRole("button", { name: "Enable text wrapping" });
  await expect(wrap).toHaveAttribute("aria-pressed", "false");
  await wrap.click();
  await expect(code).toHaveCSS("white-space", "pre-wrap");
  const toolbarRect = await actions.boundingBox();
  const contentRect = await page.getByTestId("code-scroll-area").boundingBox();
  expect(contentRect!.y).toBeGreaterThanOrEqual(
    toolbarRect!.y + toolbarRect!.height,
  );
  const coarse = await page.evaluate(
    () => matchMedia("(pointer: coarse)").matches,
  );
  for (const button of await actions.getByRole("button").all()) {
    const rect = await button.boundingBox();
    expect(rect!.width).toBeGreaterThanOrEqual(coarse ? 44 : 24);
    expect(rect!.height).toBeGreaterThanOrEqual(coarse ? 44 : 24);
  }
  await page.getByRole("button", { name: "Parent wrap" }).focus();
  await page.keyboard.press(browserName === "webkit" ? "Alt+Tab" : "Tab");
  const download = actions.getByRole("button", { name: "Download" });
  await expect(download).toBeFocused();
  await expect(download).toHaveCSS("outline-style", "solid");
  await expect(download).toHaveCSS("outline-width", "2px");
  await actions.getByRole("button", { name: "Copy", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).__copiedCode))
    .toBe(content);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
