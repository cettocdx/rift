import { defineConfig } from "@playwright/test";
import tools from "./playwright.mobile-tools.config";
export default defineConfig({
  ...tools,
  use: { ...tools.use, baseURL: "http://127.0.0.1:3062" },
  testMatch: "hack.fixture.ts",
  outputDir: "./results/hack",
  reporter: [
    ["list"],
    ["json", { outputFile: "e2e/mobile-fixture/results/hack/report.json" }],
  ],
  webServer: {
    cwd: "../..",
    url: "http://127.0.0.1:3062/health",
    reuseExistingServer: false,
    timeout: 120000,
    gracefulShutdown: { signal: "SIGTERM", timeout: 1000 },
    command:
      "RIFT_FIXTURE_PORT=3062 RIFT_HACK_FIXTURE=1 node e2e/mobile-fixture/server.cjs",
  },
});
