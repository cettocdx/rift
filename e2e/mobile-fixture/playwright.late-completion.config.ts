import { defineConfig } from "@playwright/test";
import path from "node:path";
import transcript from "./playwright.transcript.config";
export default defineConfig({
  ...transcript,
  testMatch: "late-completion.fixture.ts",
  outputDir: "./results/late-completion",
  reporter: [
    ["list"],
    [
      "json",
      {
        outputFile: path.join(__dirname, "results/late-completion/report.json"),
      },
    ],
  ],
  use: { ...transcript.use, baseURL: "http://127.0.0.1:3043" },
  webServer: {
    ...transcript.webServer,
    command:
      "RIFT_FIXTURE_PORT=3043 RIFT_TRANSCRIPT_FIXTURE=1 node e2e/mobile-fixture/server.cjs",
    cwd: "../..",
    url: "http://127.0.0.1:3043/health",
    reuseExistingServer: false,
    timeout: 120000,
    gracefulShutdown: { signal: "SIGTERM", timeout: 1000 },
  },
});
