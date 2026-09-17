import { defineConfig } from "@playwright/test";
import path from "node:path";
import receipts from "./playwright.late-completion.config";

export default defineConfig({
  ...receipts,
  testMatch: "media-download.fixture.ts",
  outputDir: "./results/media-download",
  reporter: [
    ["list"],
    [
      "json",
      {
        outputFile: path.join(__dirname, "results/media-download/report.json"),
      },
    ],
  ],
});
