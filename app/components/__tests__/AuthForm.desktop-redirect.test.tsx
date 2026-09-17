import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { useRouter, useSearchParams } from "next/navigation";
import AuthForm from "../AuthForm";

jest.mock("next/navigation", () => ({
  useRouter: jest.fn(),
  useSearchParams: jest.fn(),
}));

describe("AuthForm desktop redirect continuity", () => {
  beforeEach(() => {
    jest.mocked(useRouter).mockReturnValue({ push: jest.fn() } as never);
    jest
      .mocked(useSearchParams)
      .mockReturnValue(new URLSearchParams() as never);
  });

  it.each([
    ["signIn" as const, "Create an account", "/signup"],
    ["signUp" as const, "Sign in", "/login"],
  ])(
    "preserves a sanitized desktop return when switching from %s",
    (flow, linkName, destination) => {
      const desktopState = "a".repeat(64);
      const redirect = `/desktop-login?desktop_state=${desktopState}&returnTo=%2Fstudio`;
      jest
        .mocked(useSearchParams)
        .mockReturnValue(
          new URLSearchParams([["redirect", redirect]]) as never,
        );

      render(<AuthForm flow={flow} />);

      expect(screen.getByRole("link", { name: linkName })).toHaveAttribute(
        "href",
        `${destination}?${new URLSearchParams({ redirect }).toString()}`,
      );
    },
  );

  it("does not reflect an unsafe redirect into the account switch link", () => {
    jest
      .mocked(useSearchParams)
      .mockReturnValue(
        new URLSearchParams([
          ["redirect", "https://attacker.example/collect"],
        ]) as never,
      );

    render(<AuthForm flow="signIn" />);

    expect(
      screen.getByRole("link", { name: "Create an account" }),
    ).toHaveAttribute("href", "/signup");
  });
});
