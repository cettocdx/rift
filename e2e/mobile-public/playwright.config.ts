import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

const baseURL = process.env.MOBILE_PUBLIC_BASE_URL || "http://localhost:3020";
const origin = new URL(baseURL);
if (
  !["http:", "https:"].includes(origin.protocol) ||
  origin.username ||
  origin.password ||
  origin.pathname !== "/" ||
  origin.search ||
  origin.hash
) {
  throw new Error(
    "MOBILE_PUBLIC_BASE_URL must be an HTTP(S) origin without credentials, route, query, or fragment.",
  );
}

// Only the already-running app. No root setup, login, or managed web server.
export default defineConfig({
  testDir: __dirname,
  testMatch: "*.acceptance.ts",
  outputDir: "./results",
  timeout: 40_000,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  reporter: [
    ["list"],
    ["json", { outputFile: path.join(__dirname, "results/report.json") }],
  ],
  use: {
    baseURL: origin.origin,
    storageState: { cookies: [], origins: [] },
    serviceWorkers: "block",
    navigationTimeout: 30_000,
    actionTimeout: 10_000,
    trace: "off",
  },
  projects: (["chromium", "webkit"] as const).flatMap((browserName) =>
    [360, 390, 430].map((width) => ({
      name: `${browserName}-${width}`,
      use: {
        ...devices[browserName === "webkit" ? "iPhone 13" : "Pixel 7"],
        browserName,
        viewport: { width, height: 844 },
        screen: { width, height: 844 },
      },
    })),
  ),
});
