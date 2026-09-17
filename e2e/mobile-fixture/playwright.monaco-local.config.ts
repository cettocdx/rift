import { defineConfig } from "@playwright/test";
import files from "./playwright.workbench-file.config";

export default defineConfig({
  ...files,
  testMatch: "monaco-local.fixture.ts",
  outputDir: "./results/monaco-local",
  timeout: 60_000,
  reporter: [
    ["list"],
    [
      "json",
      { outputFile: "e2e/mobile-fixture/results/monaco-local/report.json" },
    ],
  ],
});
