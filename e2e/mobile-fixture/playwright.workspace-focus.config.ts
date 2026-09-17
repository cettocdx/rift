import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: "workspace-focus.fixture.ts",
  workers: 1,
  outputDir: "./results/workspace-focus",
  retries: 0,
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "webkit", use: { browserName: "webkit" } },
  ],
  reporter: "list",
});
