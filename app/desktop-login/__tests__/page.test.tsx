import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { ReactNode } from "react";

const mockCookies = jest.fn();
const mockHeaders = jest.fn();
const mockRedirect = jest.fn();
const mockGetUserID = jest.fn();
const mockCreateDesktopTransferToken = jest.fn();
const mockSealDesktopAuthSession = jest.fn();

jest.mock("next/headers", () => ({
  cookies: mockCookies,
  headers: mockHeaders,
}));

jest.mock("next/navigation", () => ({
  redirect: mockRedirect,
}));

jest.mock("@/lib/auth/get-user-id", () => ({
  getUserID: mockGetUserID,
}));

jest.mock("@/lib/desktop-auth", () => ({
  createDesktopTransferToken: mockCreateDesktopTransferToken,
}));

jest.mock("@/lib/desktop-auth-session", () => ({
  sealDesktopAuthSession: mockSealDesktopAuthSession,
}));

jest.mock("@/app/components/ZauthPageShell", () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));

describe("desktop OAuth return page", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("stays on desktop-login while the global handler exchanges an OAuth code", async () => {
    const desktopState = "a".repeat(64);
    const { default: DesktopLoginPage } = await import("../page");
    const page = await DesktopLoginPage({
      searchParams: Promise.resolve({
        desktop_state: desktopState,
        returnTo: "/studio",
        code: "one-time-code",
      }),
    });

    render(page);

    expect(screen.getByRole("status")).toHaveTextContent(
      "Finishing desktop sign-in",
    );
    expect(mockRedirect).not.toHaveBeenCalled();
    expect(mockHeaders).not.toHaveBeenCalled();
    expect(mockCookies).not.toHaveBeenCalled();
    expect(mockCreateDesktopTransferToken).not.toHaveBeenCalled();
  });
});
