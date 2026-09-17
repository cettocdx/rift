import { defineConfig } from "@playwright/test";
import path from "node:path";
import shell from "./playwright.chat-shell.config";
export default defineConfig({
  ...shell,
  testMatch: "transcript.fixture.ts",
  outputDir: "./results/transcript",
  reporter: [
    ["list"],
    [
      "json",
      { outputFile: path.join(__dirname, "results/transcript/report.json") },
    ],
  ],
  webServer: {
    command: "RIFT_TRANSCRIPT_FIXTURE=1 node e2e/mobile-fixture/server.cjs",
    cwd: "../..",
    url: "http://127.0.0.1:3038/health",
    reuseExistingServer: false,
    gracefulShutdown: { signal: "SIGTERM", timeout: 1000 },
    timeout: 120000,
  },
});
