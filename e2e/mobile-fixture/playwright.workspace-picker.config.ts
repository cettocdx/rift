import { defineConfig } from "@playwright/test";
import shell from "./playwright.chat-shell.config";
export default defineConfig({
  ...shell,
  testMatch: "workspace-picker.fixture.ts",
  outputDir: "./results/workspace-picker",
  reporter: "list",
  use: { ...shell.use, baseURL: "http://127.0.0.1:3046" },
  projects: shell.projects,
  webServer: {
    command:
      "RIFT_FIXTURE_PORT=3046 RIFT_TRANSCRIPT_FIXTURE=1 node e2e/mobile-fixture/server.cjs",
    cwd: "../..",
    url: "http://127.0.0.1:3046/health",
    reuseExistingServer: false,
    gracefulShutdown: { signal: "SIGTERM", timeout: 1000 },
    timeout: 120000,
  },
});
