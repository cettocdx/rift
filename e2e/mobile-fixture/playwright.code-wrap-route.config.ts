import { defineConfig } from "@playwright/test";
import path from "node:path";
import base from "./playwright.transcript.config";
export default defineConfig({
  ...base,
  testMatch: "code-wrap-route.fixture.ts",
  projects: base.projects?.filter(
    (project) =>
      project.name?.endsWith("-desktop") || project.name?.endsWith("-390"),
  ),
  use: { ...base.use, baseURL: "http://127.0.0.1:3039" },
  outputDir: "./results/code-wrap-route",
  reporter: [
    ["list"],
    [
      "json",
      {
        outputFile: path.join(__dirname, "results/code-wrap-route/report.json"),
      },
    ],
  ],
  webServer: {
    command:
      "RIFT_FIXTURE_PORT=3039 RIFT_TRANSCRIPT_FIXTURE=1 node e2e/mobile-fixture/server.cjs",
    cwd: "../..",
    url: "http://127.0.0.1:3039/health",
    reuseExistingServer: false,
    timeout: 120000,
    gracefulShutdown: { signal: "SIGTERM", timeout: 1000 },
  },
});
