import { defineConfig } from "@playwright/test";
import transcript from "./playwright.transcript.config";
export default defineConfig({
  ...transcript,
  use: { ...transcript.use, baseURL: "http://127.0.0.1:3045" },
  testMatch: "mobile-tools.fixture.ts",
  outputDir: "./results/mobile-tools",
  reporter: [
    ["list"],
    [
      "json",
      { outputFile: "e2e/mobile-fixture/results/mobile-tools/report.json" },
    ],
  ],
  projects: transcript.projects!.filter((project) => project.use?.isMobile),
  webServer: {
    cwd: "../..",
    url: "http://127.0.0.1:3045/health",
    reuseExistingServer: false,
    gracefulShutdown: { signal: "SIGTERM", timeout: 1000 },
    timeout: 120000,
    command:
      "RIFT_FIXTURE_PORT=3045 RIFT_TRANSCRIPT_FIXTURE=1 RIFT_MOBILE_TOOLS_FIXTURE=1 node e2e/mobile-fixture/server.cjs",
  },
});
