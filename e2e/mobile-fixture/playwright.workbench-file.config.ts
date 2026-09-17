import { defineConfig } from "@playwright/test";
import path from "node:path";

export default defineConfig({
  testDir: ".",
  testMatch: "workbench-file.fixture.ts",
  outputDir: "./results/workbench-file",
  workers: 1,
  retries: 0,
  timeout: 30_000,
  reporter: [
    ["list"],
    [
      "json",
      {
        outputFile: path.join(__dirname, "results/workbench-file/report.json"),
      },
    ],
  ],
  projects: ["chromium", "webkit"].flatMap((browserName) => [
    ...[360, 390, 430].map((width) => ({
      name: `${browserName}-${width}-coarse`,
      use: {
        browserName: browserName as "chromium" | "webkit",
        viewport: { width, height: 844 },
        hasTouch: true,
        isMobile: true,
      },
    })),
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
