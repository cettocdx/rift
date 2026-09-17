import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: "native-material.fixture.ts",
  workers: 1,
  outputDir: "./results/native-material",
  retries: 0,
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "webkit", use: { browserName: "webkit" } },
  ],
  use: { viewport: { width: 1200, height: 900 } },
  reporter: "list",
});
