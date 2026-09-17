import { defineConfig } from "@playwright/test";
import base from "./playwright.terminal-header.config";
export default defineConfig({
  ...base,
  testMatch: "agent-tray.fixture.ts",
  outputDir: "./results/agent-tray",
  reporter: [
    ["list"],
    [
      "json",
      { outputFile: "e2e/mobile-fixture/results/agent-tray/report.json" },
    ],
  ],
});
