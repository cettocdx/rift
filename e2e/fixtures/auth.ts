import type { Browser, Page, BrowserContext } from "@playwright/test";
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { TIMEOUTS } from "../constants";
import { canonicalizeEmail } from "../../convex/emailCanonical";
import {
  hasConvexSessionCookie,
  verifyAuthenticatedSession,
} from "./verify-authenticated-session";

export { verifyAuthenticatedSession } from "./verify-authenticated-session";

export type TestUserTier = "free" | "pro" | "ultra";
export interface TestUser {
  email: string;
  password: string;
  tier: TestUserTier;
}

/** Actual, pre-existing Convex Auth accounts only; no baked-in credentials. */
export function getConfiguredTestUser(tier: TestUserTier): TestUser {
  const prefix = `TEST_${tier.toUpperCase()}_TIER`;
  const email = process.env[`${prefix}_USER`]?.trim();
  const password = process.env[`${prefix}_PASSWORD`];
  if (!email || !password) {
    throw new Error(
      `${prefix}_USER and ${prefix}_PASSWORD are required for E2E login.`,
    );
  }
  for (const other of ["free", "pro", "ultra"] as const) {
    const otherEmail = process.env[`TEST_${other.toUpperCase()}_TIER_USER`];
    if (
      other !== tier &&
      otherEmail &&
      canonicalizeEmail(otherEmail) === canonicalizeEmail(email)
    ) {
      throw new Error("Each E2E tier requires a distinct verified account.");
    }
  }
  return { email, password, tier };
}

// Resolve at test execution, so --list works without credentials.
export const TEST_USERS = {
  get free() {
    return getConfiguredTestUser("free");
  },
  get pro() {
    return getConfiguredTestUser("pro");
  },
  get ultra() {
    return getConfiguredTestUser("ultra");
  },
};

export const AUTH_STORAGE_PATHS = {
  free: "e2e/.auth/free.json",
  pro: "e2e/.auth/pro.json",
  ultra: "e2e/.auth/ultra.json",
} as const;

export interface AuthOptions {
  baseURL: string;
  skipCache?: boolean;
}

async function waitForAuthenticatedUI(page: Page) {
  await page
    .getByTestId("user-menu-button")
    .or(page.getByTestId("user-menu-button-collapsed"))
    .first()
    .waitFor({ state: "visible", timeout: TIMEOUTS.SHORT });
}

async function saveVerifiedState(context: BrowserContext, path: string) {
  const state = await context.storageState();
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, JSON.stringify(state), { mode: 0o600 });
  chmodSync(path, 0o600);
}

export async function authenticateUser(
  browser: Browser,
  user: TestUser,
  { baseURL, skipCache = false }: AuthOptions,
): Promise<void> {
  if (!process.env.NEXT_PUBLIC_CONVEX_URL) {
    throw new Error(
      "NEXT_PUBLIC_CONVEX_URL is required to verify the E2E session.",
    );
  }
  const path = join(process.cwd(), AUTH_STORAGE_PATHS[user.tier]);
  if (!skipCache && existsSync(path)) {
    let context: BrowserContext | undefined;
    try {
      // Restore cookies AND origin storage without partial replay.
      context = await browser.newContext({ baseURL, storageState: path });
      const page = await context.newPage();
      await page.goto("/");
      await waitForAuthenticatedUI(page);
      await verifyAuthenticatedSession(context, baseURL, user);
      await saveVerifiedState(context, path);
      return;
    } catch {
      // A stale, wrong-account or malformed cache gets one clean real login.
      // Never overwrite the cache until that login has also been verified.
    } finally {
      await context?.close();
    }
  }

  const context = await browser.newContext({ baseURL });
  try {
    const page = await context.newPage();
    await page.goto("/login");
    await page.getByLabel("Email", { exact: true }).fill(user.email);
    await page.getByLabel("Password", { exact: true }).fill(user.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL(
      (url) => url.pathname === "/" || url.pathname.startsWith("/c/"),
      { timeout: TIMEOUTS.MEDIUM },
    );
    await waitForAuthenticatedUI(page);
    await verifyAuthenticatedSession(context, baseURL, user);
    await saveVerifiedState(context, path);
  } catch {
    throw new Error(
      `E2E ${user.tier} sign-in could not verify the configured account and live tier. Check the external credentials, account verification and Convex deployment.`,
    );
  } finally {
    await context.close();
  }
}

export async function logout(page: Page): Promise<void> {
  await page
    .getByTestId("user-menu-button")
    .or(page.getByTestId("user-menu-button-collapsed"))
    .first()
    .click();
  await page.getByTestId("logout-button").click();
  await page.waitForURL("/", { timeout: TIMEOUTS.SHORT });
  await page
    .getByTestId("sign-in-button")
    .or(page.getByTestId("sign-in-button-mobile"))
    .first()
    .waitFor({ state: "visible", timeout: TIMEOUTS.SHORT });
}

/** Read-only server verification; never reports cookie presence as valid auth. */
export async function getAuthState(
  context: BrowserContext,
  baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3010",
): Promise<{ isAuthenticated: boolean; hasCookies: boolean }> {
  const hasCookies = await hasConvexSessionCookie(context, baseURL);
  try {
    await verifyAuthenticatedSession(context, baseURL);
    return { isAuthenticated: true, hasCookies };
  } catch {
    return { isAuthenticated: false, hasCookies };
  }
}
