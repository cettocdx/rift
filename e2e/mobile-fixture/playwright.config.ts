import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

export default defineConfig({
  testDir: ".",
  // Keep fixture tests out of the separate authenticated root E2E suite.
  testMatch: "mobile.fixture.ts",
  outputDir: "./results",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  reporter: [
    ["list"],
    ["json", { outputFile: path.join(__dirname, "results/report.json") }],
  ],
  use: {
    baseURL: "http://127.0.0.1:3037",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "Mobile Chrome", use: { ...devices["Pixel 7"] } },
    { name: "Mobile Safari", use: { ...devices["iPhone 15"] } },
  ],
  webServer: {
    command: "node e2e/mobile-fixture/server.cjs",
    cwd: "../..",
    url: "http://127.0.0.1:3037/health",
    reuseExistingServer: false,
    gracefulShutdown: { signal: "SIGTERM", timeout: 1000 },
    timeout: 120_000,
  },
});
