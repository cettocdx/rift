import { test as setup } from "@playwright/test";
import { authenticateUser, TEST_USERS } from "../fixtures/auth";
import { config } from "dotenv";
import { resolve } from "path";

// Load .env.e2e
config({ path: resolve(process.cwd(), ".env.e2e") });

// Login artifacts can contain credentials and session state.
setup.use({ trace: "off", screenshot: "off", video: "off" });

setup("authenticate free tier", async ({ browser, baseURL }) => {
  await authenticateUser(browser, TEST_USERS.free, { baseURL: baseURL! });
});

setup("authenticate pro tier", async ({ browser, baseURL }) => {
  await authenticateUser(browser, TEST_USERS.pro, { baseURL: baseURL! });
});

setup("authenticate ultra tier", async ({ browser, baseURL }) => {
  await authenticateUser(browser, TEST_USERS.ultra, { baseURL: baseURL! });
});
