import { defineConfig } from "@playwright/test";
import path from "node:path";

export default defineConfig({
  testDir: ".",
  testMatch: "all-files.fixture.ts",
  outputDir: "./results/all-files",
  workers: 1,
  retries: 0,
  timeout: 30_000,
  reporter: [
    ["list"],
    [
      "json",
      { outputFile: path.join(__dirname, "results/all-files/report.json") },
    ],
  ],
  projects: ["chromium", "webkit"].flatMap((browserName) => [
    ...[360, 390, 430].flatMap((width) =>
      [true, false].map((hasTouch) => ({
        name: `${browserName}-${width}-${hasTouch ? "coarse" : "fine"}`,
        use: {
          browserName: browserName as "chromium" | "webkit",
          viewport: { width, height: 844 },
          hasTouch,
          isMobile: hasTouch,
        },
      })),
    ),
    {
      name: `${browserName}-desktop`,
      use: {
        browserName: browserName as "chromium" | "webkit",
        viewport: { width: 1200, height: 900 },
        hasTouch: false,
      },
    },
  ]),
});
