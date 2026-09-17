import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = (path: string) =>
  readFileSync(join(process.cwd(), path), "utf8");

describe("route landmark contract", () => {
  it("makes the Pro skip-link target the single authenticated main landmark", () => {
    const shell = source("app/components/pro/ProChatLayout.tsx");
    const standardShell = source("app/components/ChatLayout.tsx");
    const nestedAuthenticatedSurfaces = [
      source("app/components/tasks/TaskCenter.tsx"),
      source("app/(chat)/settings/layout.tsx"),
      source("app/components/settings/SettingsShell.tsx"),
      source("app/(chat)/tasks/error.tsx"),
    ].join("\n");

    expect(shell).toContain('href="#rift-pro-main"');
    expect(shell).toMatch(/<main\s+[\s\S]*?id="rift-pro-main"/);
    expect(shell).toContain("data-rift-main-panel");
    expect(standardShell).toMatch(/<main\s+[\s\S]*?data-rift-main-panel/);
    expect(nestedAuthenticatedSurfaces).not.toContain("<main");
  });

  it("keeps core authenticated routes inside the shared main landmark", () => {
    const routes = [
      "app/(chat)/page.tsx",
      "app/(chat)/studio/page.tsx",
      "app/(chat)/agents/page.tsx",
      "app/(chat)/artifacts/page.tsx",
      "app/(chat)/plugins/page.tsx",
    ];
    const shell = source("app/(chat)/ChatRouteShell.tsx");

    expect(shell).toContain("<ProChatShell>{children}</ProChatShell>");
    for (const route of routes) {
      expect(source(route).length).toBeGreaterThan(0);
    }
  });

  it("keeps the Artifacts route in Vercel deployment uploads", () => {
    expect(source("app/(chat)/artifacts/page.tsx").length).toBeGreaterThan(0);

    const ignoredPaths = source(".vercelignore")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"));

    expect(ignoredPaths).not.toContain("artifacts");
    expect(ignoredPaths).toContain("/artifacts");
  });

  it("gives the download content a main landmark", () => {
    // The landmark moved up into the shared marketing shell when this page
    // adopted it, so the page must render through that shell rather than
    // declaring a second main of its own.
    const downloadSource = source("app/download/DownloadPageContent.tsx");
    expect(downloadSource).toMatch(/<MarketingPage[\s>]/);
    expect(downloadSource).not.toMatch(/<main[\s>]/);
    expect(source("app/components/marketing/MarketingPage.tsx")).toMatch(
      /<main[\s>]/,
    );
  });

  it.each(["rift1", "rift2", "rift3"])(
    "keeps the legacy %s preview out of production search results",
    (variant) => {
      const preview = source(`app/landing/${variant}/page.tsx`);
      expect(preview).toContain("robots: { index: false, follow: false }");
      expect(preview).toContain('process.env.NODE_ENV === "production"');
      expect(preview).toContain("notFound()");
      expect(preview).not.toContain('"use client"');
    },
  );
});
