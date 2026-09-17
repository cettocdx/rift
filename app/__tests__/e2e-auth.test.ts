/** @jest-environment node */
import {
  authenticateUser,
  getAuthState,
  getConfiguredTestUser,
} from "../../e2e/fixtures/auth";
import { verifyAuthenticatedSession } from "../../e2e/fixtures/verify-authenticated-session";
import { existsSync, writeFileSync } from "fs";

const mockQuery = jest.fn();
const mockSetAuth = jest.fn();
jest.mock("convex/browser", () => ({
  ConvexHttpClient: jest.fn(() => ({ query: mockQuery, setAuth: mockSetAuth })),
}));
jest.mock("fs", () => ({
  ...jest.requireActual("fs"),
  existsSync: jest.fn(() => false),
  mkdirSync: jest.fn(),
  writeFileSync: jest.fn(),
  chmodSync: jest.fn(),
}));

const baseURL = "http://localhost:3010";
const contextWithCookies = (names: string[]) => ({
  cookies: jest.fn(async () =>
    names.map((name) => ({ name, value: "test-only" })),
  ),
});

beforeEach(() => {
  jest.clearAllMocks();
  (existsSync as jest.Mock).mockReturnValue(false);
  process.env.NEXT_PUBLIC_CONVEX_URL = "https://test.convex.cloud";
  mockQuery.mockReset();
  mockQuery
    .mockResolvedValueOnce({ _id: "user-1", email: "qa@example.com" })
    .mockResolvedValueOnce(["pro-plan"]);
});

it("verifies production-prefixed cookies only for their actual origin", async () => {
  const context = contextWithCookies(["__Host-__convexAuthJWT"]);
  await expect(
    verifyAuthenticatedSession(
      context as never,
      "https://test.example.com/path",
      {
        email: "qa@example.com",
        tier: "pro",
      },
    ),
  ).resolves.toEqual({
    userId: "user-1",
    email: "qa@example.com",
    tier: "pro",
  });
  expect(context.cookies).toHaveBeenCalledWith("https://test.example.com");
});

it("rejects a valid session for the wrong account", async () => {
  await expect(
    verifyAuthenticatedSession(
      contextWithCookies(["__convexAuthJWT"]) as never,
      baseURL,
      {
        email: "another@example.com",
      },
    ),
  ).rejects.toThrow("different E2E account");
});

it("rejects a valid identity with the wrong live tier", async () => {
  await expect(
    verifyAuthenticatedSession(
      contextWithCookies(["__convexAuthJWT"]) as never,
      baseURL,
      {
        email: "qa@example.com",
        tier: "ultra",
      },
    ),
  ).rejects.toThrow("required live subscription tier");
});

it("does not expose server error details when verification fails", async () => {
  mockQuery
    .mockReset()
    .mockRejectedValue(new Error("sensitive backend details"));
  await expect(
    verifyAuthenticatedSession(
      contextWithCookies(["__convexAuthJWT"]) as never,
      baseURL,
    ),
  ).rejects.toThrow(
    "Convex could not verify the E2E session and entitlements.",
  );
});

const testUser = {
  email: "qa@example.com",
  password: "unit-test-only",
  tier: "pro" as const,
};

function loginContext() {
  const locator = {
    or: jest.fn().mockReturnThis(),
    first: jest.fn().mockReturnThis(),
    waitFor: jest.fn(async () => {}),
    fill: jest.fn(async () => {}),
    click: jest.fn(async () => {}),
  };
  const page = {
    goto: jest.fn(async () => {}),
    getByLabel: jest.fn(() => locator),
    getByRole: jest.fn(() => locator),
    getByTestId: jest.fn(() => locator),
    waitForURL: jest.fn(async () => {}),
  };
  const context = {
    ...contextWithCookies(["__convexAuthJWT"]),
    newPage: jest.fn(async () => page),
    close: jest.fn(async () => {}),
    storageState: jest.fn(async () => ({ cookies: [], origins: [] })),
  };
  return { context, page, locator };
}

it("uses the current single-form login and saves only a verified tier session", async () => {
  const { context, page, locator } = loginContext();
  const browser = { newContext: jest.fn(async () => context) };
  await authenticateUser(browser as never, testUser, { baseURL });
  expect(page.goto).toHaveBeenCalledWith("/login");
  expect(page.getByLabel).toHaveBeenCalledWith("Email", { exact: true });
  expect(page.getByLabel).toHaveBeenCalledWith("Password", { exact: true });
  expect(page.getByRole).toHaveBeenCalledWith("button", {
    name: "Sign in",
    exact: true,
  });
  expect(locator.click).toHaveBeenCalledWith();
  expect(writeFileSync).toHaveBeenCalledTimes(1);
  expect(context.close).toHaveBeenCalledTimes(1);
});

it("restores full cached storage in an isolated context and verifies its identity", async () => {
  (existsSync as jest.Mock).mockReturnValue(true);
  const { context, page } = loginContext();
  const browser = { newContext: jest.fn(async () => context) };
  await authenticateUser(browser as never, testUser, { baseURL });
  expect(browser.newContext).toHaveBeenCalledWith({
    baseURL,
    storageState: expect.stringMatching(/e2e\/\.auth\/pro\.json$/),
  });
  expect(page.goto).toHaveBeenCalledWith("/");
  expect(page.getByLabel).not.toHaveBeenCalled();
  expect(mockQuery).toHaveBeenCalledTimes(2);
  expect(writeFileSync).toHaveBeenCalledTimes(1);
});

it("replaces a wrong-account cache only after a clean verified login", async () => {
  (existsSync as jest.Mock).mockReturnValue(true);
  mockQuery
    .mockReset()
    .mockResolvedValueOnce({ _id: "other", email: "other@example.com" })
    .mockResolvedValueOnce(["pro-plan"])
    .mockResolvedValueOnce({ _id: "user-1", email: testUser.email })
    .mockResolvedValueOnce(["pro-plan"]);
  const cached = loginContext();
  const fresh = loginContext();
  const browser = {
    newContext: jest
      .fn()
      .mockResolvedValueOnce(cached.context)
      .mockResolvedValueOnce(fresh.context),
  };
  await authenticateUser(browser as never, testUser, { baseURL });
  expect(cached.context.storageState).not.toHaveBeenCalled();
  expect(cached.context.close).toHaveBeenCalled();
  expect(browser.newContext).toHaveBeenLastCalledWith({ baseURL });
  expect(fresh.page.goto).toHaveBeenCalledWith("/login");
  expect(writeFileSync).toHaveBeenCalledTimes(1);
});

it("never saves a successful-looking login for a different account", async () => {
  mockQuery
    .mockReset()
    .mockResolvedValueOnce({ _id: "other", email: "other@example.com" })
    .mockResolvedValueOnce(["pro-plan"]);
  const { context } = loginContext();
  const browser = { newContext: jest.fn(async () => context) };
  await expect(
    authenticateUser(browser as never, testUser, { baseURL }),
  ).rejects.toThrow("could not verify the configured account and live tier");
  expect(writeFileSync).not.toHaveBeenCalled();
  expect(context.close).toHaveBeenCalled();
});

it("requires external credentials and rejects tier aliases sharing one identity", () => {
  const names = [
    "TEST_FREE_TIER_USER",
    "TEST_FREE_TIER_PASSWORD",
    "TEST_PRO_TIER_USER",
    "TEST_PRO_TIER_PASSWORD",
  ];
  const previous = names.map((name) => process.env[name]);
  try {
    for (const name of names) delete process.env[name];
    expect(() => getConfiguredTestUser("free")).toThrow("are required");
    process.env.TEST_FREE_TIER_USER = "qa+free@example.com";
    process.env.TEST_FREE_TIER_PASSWORD = "unit-test-only";
    process.env.TEST_PRO_TIER_USER = "qa+pro@example.com";
    process.env.TEST_PRO_TIER_PASSWORD = "unit-test-only";
    expect(() => getConfiguredTestUser("free")).toThrow(
      "distinct verified account",
    );
  } finally {
    names.forEach((name, index) => {
      if (previous[index] === undefined) delete process.env[name];
      else process.env[name] = previous[index];
    });
  }
});

it("recognizes a real Convex session only after server verification", async () => {
  const context = contextWithCookies(["__convexAuthJWT"]);
  await expect(getAuthState(context as never, baseURL)).resolves.toEqual({
    isAuthenticated: true,
    hasCookies: true,
  });
  expect(mockQuery).toHaveBeenCalledTimes(2);
});

it("does not mistake a legacy WorkOS cookie for an authenticated session", async () => {
  const context = contextWithCookies(["wos-session"]);
  await expect(getAuthState(context as never, baseURL)).resolves.toEqual({
    isAuthenticated: false,
    hasCookies: false,
  });
  expect(mockQuery).not.toHaveBeenCalled();
});

it("does not treat an expired or rejected Convex cookie as authenticated", async () => {
  mockQuery.mockReset().mockResolvedValue(null);
  const context = contextWithCookies(["__convexAuthJWT"]);
  await expect(getAuthState(context as never, baseURL)).resolves.toEqual({
    isAuthenticated: false,
    hasCookies: true,
  });
});
