import { defineConfig } from "@playwright/test";
import path from "node:path";
import transcript from "./playwright.transcript.config";

// Development-React attribution only. Keep screenshots/tracing outside the
// measured checkpoints; this is not the production performance acceptance gate.
export default defineConfig({
  ...transcript,
  testMatch: "completion-profile.fixture.ts",
  projects: transcript.projects?.filter(
    (project) => project.name === "webkit-desktop",
  ),
  workers: 1,
  use: {
    ...transcript.use,
    baseURL: "http://127.0.0.1:3039",
    trace: "off",
    screenshot: "off",
  },
  outputDir: "./results/completion-profile",
  reporter: [
    ["list"],
    [
      "json",
      {
        outputFile: path.join(
          __dirname,
          "results/completion-profile/report.json",
        ),
      },
    ],
  ],
  webServer: {
    command:
      "RIFT_FIXTURE_PORT=3039 RIFT_TRANSCRIPT_FIXTURE=1 RIFT_COMPLETION_PROFILE=1 node e2e/mobile-fixture/server.cjs",
    cwd: "../..",
    url: "http://127.0.0.1:3039/health",
    reuseExistingServer: false,
    timeout: 120000,
    gracefulShutdown: { signal: "SIGTERM", timeout: 1000 },
  },
});
