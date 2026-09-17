import path from "node:path";
import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: "terminal.fixture.ts",
  workers: 1,
  retries: 0,
  timeout: 60_000,
  outputDir: "./results/terminal",
  reporter: [
    ["list"],
    [
      "json",
      { outputFile: path.join(__dirname, "results/terminal/report.json") },
    ],
  ],
  projects: ["chromium", "webkit"].flatMap((browserName) =>
    [1200, 390].map((width) => ({
      name: `${browserName}-${width}`,
      use: {
        browserName: browserName as "chromium" | "webkit",
        viewport: { width, height: 850 },
        hasTouch: width === 390,
        isMobile: width === 390,
        trace: "off" as const,
      },
    })),
  ),
});
