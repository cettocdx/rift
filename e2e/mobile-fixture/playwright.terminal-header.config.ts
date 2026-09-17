import path from "node:path";
import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: "terminal-header.fixture.ts",
  workers: 1,
  retries: 0,
  timeout: 30_000,
  outputDir: "./results/terminal-header",
  reporter: [
    ["list"],
    [
      "json",
      {
        outputFile: path.join(__dirname, "results/terminal-header/report.json"),
      },
    ],
  ],
  projects: ["chromium", "webkit"].flatMap((browserName) =>
    [false, true].map((hasTouch) => ({
      name: `${browserName}-${hasTouch ? "touch" : "mouse"}`,
      use: {
        browserName: browserName as "chromium" | "webkit",
        viewport: { width: 800, height: 750 },
        hasTouch,
        trace: "off" as const,
      },
    })),
  ),
});
