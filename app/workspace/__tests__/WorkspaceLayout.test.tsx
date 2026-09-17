import React from "react";
import { ChatSDKError } from "@/lib/errors";
import WorkspaceLayout from "../layout";

const mockGetUserIDAndPro = jest.fn();
const mockRedirect = jest.fn((destination: string): never => {
  throw new Error(`REDIRECT:${destination}`);
});

jest.mock("@/lib/auth/get-user-id", () => ({
  getUserIDAndPro: (...args: unknown[]) => mockGetUserIDAndPro(...args),
}));

jest.mock("next/navigation", () => ({
  redirect: (destination: string) => mockRedirect(destination),
}));

jest.mock("@/app/components/pro/ProShellContext", () => ({
  ProShellProvider: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock("@/app/components/workbench/CursorIdeLayout", () => ({
  CursorIdeLayout: ({ children }: { children: React.ReactNode }) => children,
}));

describe("CLI Workspace route gate", () => {
  const originalSkin = process.env.RIFT_UI_SKIN;

  beforeEach(() => {
    mockGetUserIDAndPro.mockReset();
    mockRedirect.mockClear();
    delete process.env.RIFT_UI_SKIN;
  });

  afterAll(() => {
    if (originalSkin === undefined) {
      delete process.env.RIFT_UI_SKIN;
    } else {
      process.env.RIFT_UI_SKIN = originalSkin;
    }
  });

  it("renders for a paid account without a preview-skin environment flag", async () => {
    mockGetUserIDAndPro.mockResolvedValue({
      userId: "user-1",
      subscription: "pro",
    });

    const result = await WorkspaceLayout({ children: <span>workspace</span> });

    expect(React.isValidElement(result)).toBe(true);
    expect(mockRedirect).not.toHaveBeenCalled();
    expect(result.props.basePath).toBe("/workspace");
  });

  it("redirects an unauthenticated browser back through the workspace login", async () => {
    mockGetUserIDAndPro.mockRejectedValue(
      new ChatSDKError("unauthorized:auth"),
    );

    await expect(
      WorkspaceLayout({ children: <span>workspace</span> }),
    ).rejects.toThrow("REDIRECT:/login?redirect=%2Fworkspace");
  });

  it("keeps free accounts behind the premium workspace upgrade", async () => {
    mockGetUserIDAndPro.mockResolvedValue({
      userId: "user-1",
      subscription: "free",
    });

    await expect(
      WorkspaceLayout({ children: <span>workspace</span> }),
    ).rejects.toThrow("REDIRECT:/upgrade?feature=workspace");
  });
});
