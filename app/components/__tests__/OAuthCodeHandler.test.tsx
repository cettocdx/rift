import "@testing-library/jest-dom";
import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { OAuthCodeHandler } from "../OAuthCodeHandler";

const mockedAuthModule = jest.requireActual("@convex-dev/auth/react") as {
  useAuthActions: () => {
    signIn: jest.Mock<(...args: unknown[]) => Promise<unknown>>;
  };
};
const { signIn: mockSignIn } = mockedAuthModule.useAuthActions();

describe("OAuthCodeHandler", () => {
  beforeEach(() => {
    mockSignIn.mockReset();
    window.history.replaceState({}, "", "/");
  });

  it("keeps the cleaned desktop route and state while exchanging the OAuth code", async () => {
    const desktopState = "a".repeat(64);
    window.history.replaceState(
      {},
      "",
      `/desktop-login?desktop_state=${desktopState}&returnTo=%2Fstudio&code=one-time-code#finish`,
    );
    mockSignIn.mockReturnValueOnce(new Promise(() => undefined));

    render(<OAuthCodeHandler />);

    await waitFor(() =>
      expect(mockSignIn).toHaveBeenCalledWith(undefined, {
        code: "one-time-code",
      }),
    );
    expect(
      `${window.location.pathname}${window.location.search}${window.location.hash}`,
    ).toBe(
      `/desktop-login?desktop_state=${desktopState}&returnTo=%2Fstudio#finish`,
    );
  });
});
