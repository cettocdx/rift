import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

// No root setup project, dotenv credentials, signup, or managed web server.
export default defineConfig({
  testDir: __dirname,
  testMatch: "*.acceptance.ts",
  globalSetup: "./preflight.ts",
  outputDir: "./results",
  workers: 1,
  fullyParallel: false,
  retries: 0,
  forbidOnly: !!process.env.CI,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [
    ["list"],
    ["html", { outputFolder: "./report", open: "never" }],
    ["json", { outputFile: path.join(__dirname, "results/report.json") }],
  ],
  use: {
    baseURL: process.env.MOBILE_ACCEPTANCE_BASE_URL,
    storageState: process.env.MOBILE_ACCEPTANCE_STORAGE_STATE,
    navigationTimeout: 30_000,
    actionTimeout: 15_000,
    screenshot: "only-on-failure",
    // Traces can contain authenticated payloads; enable explicitly if needed.
    trace:
      process.env.MOBILE_ACCEPTANCE_TRACE === "1" ? "retain-on-failure" : "off",
    serviceWorkers: "block",
  },
  projects: (["chromium", "webkit"] as const).flatMap((browserName) =>
    [360, 390, 430].map((width) => ({
      name: `${browserName}-${width}`,
      use: {
        ...devices[browserName === "webkit" ? "iPhone 13" : "Pixel 7"],
        browserName,
        viewport: { width, height: 844 },
        screen: { width, height: 844 },
      },
    })),
  ),
});
