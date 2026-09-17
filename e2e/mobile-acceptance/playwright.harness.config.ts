import { defineConfig } from "@playwright/test";

// Synthetic harness regressions only, never authenticated acceptance evidence.
export default defineConfig({
  testDir: __dirname,
  testMatch: "*.harness.ts",
  outputDir: "./results/harness",
  workers: 1,
  retries: 0,
  timeout: 20_000,
  reporter: "list",
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "webkit", use: { browserName: "webkit" } },
  ],
});
