import "@testing-library/jest-dom";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { renderToString } from "react-dom/server";
import { useRouter, useSearchParams } from "next/navigation";
import { LoginSurface } from "@/app/login/LoginSurface";
import SignupPage from "@/app/signup/page";
import AuthForm from "../AuthForm";
import ZauthPageShell from "../ZauthPageShell";

const mockPush = jest.fn();
const mockedAuthModule = jest.requireActual("@convex-dev/auth/react") as {
  useAuthActions: () => {
    signIn: jest.Mock<(...args: unknown[]) => Promise<unknown>>;
    signOut: jest.Mock<(...args: unknown[]) => Promise<unknown>>;
  };
};
const getMockAuthActions = mockedAuthModule.useAuthActions;
const { signIn: mockSignIn, signOut: mockSignOut } = getMockAuthActions();

jest.mock("next/navigation", () => ({
  useRouter: jest.fn(),
  useSearchParams: jest.fn(),
}));

function setReducedMotion(matches: boolean) {
  window.matchMedia = jest.fn().mockImplementation((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  })) as typeof window.matchMedia;
}

describe("auth surface", () => {
  beforeEach(() => {
    mockPush.mockReset();
    mockSignIn.mockReset();
    mockSignOut.mockReset();
    jest.mocked(useRouter).mockReturnValue({ push: mockPush } as never);
    jest
      .mocked(useSearchParams)
      .mockReturnValue(new URLSearchParams() as never);
    setReducedMotion(false);
  });

  it("uses the RIFT public typography and contrast tokens outside auth", () => {
    render(
      <ZauthPageShell footer>
        <div>Public content</div>
      </ZauthPageShell>,
    );

    const shell = screen.getByText("Public content").closest("div.relative");

    expect(shell).toHaveClass("min-h-[100dvh]", "font-sans", "antialiased");
    expect(shell).not.toHaveClass("font-mono", "min-h-screen");
    // The default variant carries the auth flow's two notice pages — the
    // auth-error screen and the desktop hand-off — and both are reached from a
    // sign-in that did not complete. They run the form's palette for that
    // reason: a failed sign-in that also inverts the screen reads as a second
    // failure. It was a blue-tinted near-black, which was right when the
    // public site was dark.
    expect(shell).toHaveStyle({
      "--background": "var(--x-ground)",
      "--foreground": "var(--x-ink)",
      "--primary": "var(--x-ink)",
    });
    expect(screen.getByRole("contentinfo")).not.toHaveClass(
      "font-mono",
      "uppercase",
    );
  });

  it("keeps the sign-in field contract and order", () => {
    render(<AuthForm flow="signIn" />);

    const email = screen.getByLabelText("Email");
    const password = screen.getByLabelText("Password");

    expect(
      email.compareDocumentPosition(password) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(email).toHaveAttribute("name", "email");
    expect(password).toHaveAttribute("name", "password");
    expect(password).toHaveAttribute("autocomplete", "current-password");
    expect(screen.getByRole("button", { name: "Sign in" })).toHaveAttribute(
      "type",
      "submit",
    );
  });

  it("keeps the sign-up field names and new-password semantics", () => {
    render(<AuthForm flow="signUp" />);

    expect(screen.getByLabelText("Email")).toHaveAttribute("name", "email");
    expect(screen.getByLabelText("Password")).toHaveAttribute(
      "autocomplete",
      "new-password",
    );
    expect(
      screen.getByRole("button", { name: "Create account" }),
    ).toHaveAttribute("type", "submit");
  });

  it("preserves a safe in-app redirect for OAuth sign-in", async () => {
    const redirect = "/studio?tab=video#latest";
    jest
      .mocked(useSearchParams)
      .mockReturnValue(new URLSearchParams([["redirect", redirect]]) as never);
    mockSignIn.mockResolvedValueOnce({ signingIn: true });
    const user = userEvent.setup();
    render(<AuthForm flow="signIn" />);

    await user.click(
      screen.getByRole("button", { name: "Continue with Google" }),
    );
    expect(mockSignIn).toHaveBeenNthCalledWith(1, "google", {
      redirectTo: redirect,
    });
  });

  it("preserves a safe in-app redirect after password sign-in", async () => {
    const redirect = "/studio?tab=video#latest";
    jest
      .mocked(useSearchParams)
      .mockReturnValue(new URLSearchParams([["redirect", redirect]]) as never);
    mockSignIn.mockResolvedValueOnce({ signingIn: true });
    const user = userEvent.setup();
    render(<AuthForm flow="signIn" />);

    await user.type(screen.getByLabelText("Email"), "person@example.com");
    await user.type(screen.getByLabelText("Password"), "safe-password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith(redirect));
  });

  it("falls back to the app root for an untrusted OAuth redirect", async () => {
    jest
      .mocked(useSearchParams)
      .mockReturnValue(
        new URLSearchParams([
          ["redirect", "https://attacker.example/steal"],
        ]) as never,
      );
    mockSignIn.mockResolvedValueOnce({ signingIn: true });
    const user = userEvent.setup();
    render(<AuthForm flow="signIn" />);

    await user.click(
      screen.getByRole("button", { name: "Continue with Google" }),
    );
    expect(mockSignIn).toHaveBeenNthCalledWith(1, "google", {
      redirectTo: "/",
    });
  });

  it("falls back to the app root after password sign-in with an untrusted redirect", async () => {
    jest
      .mocked(useSearchParams)
      .mockReturnValue(
        new URLSearchParams([
          ["redirect", "https://attacker.example/steal"],
        ]) as never,
      );
    mockSignIn.mockResolvedValueOnce({ signingIn: true });
    const user = userEvent.setup();
    render(<AuthForm flow="signIn" />);

    await user.type(screen.getByLabelText("Email"), "person@example.com");
    await user.type(screen.getByLabelText("Password"), "safe-password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/"));
  });

  it("uses a 4K application preview without testimonial or film copy", () => {
    render(
      <ZauthPageShell variant="auth">
        <div>Account form</div>
      </ZauthPageShell>,
    );

    const surface = document.querySelector('[data-auth-surface="split"]');
    const nativeDragStrip = document.querySelector(
      '[data-rift-native-titlebar="auth-window"]',
    );
    const preview = screen.getByRole("complementary", {
      name: "Creative studio application preview",
    });

    // White, not black. The sign-in screen keeps the product-UI *scale*
    // measured off app.primeintellect.ai (prime-scale.ts) and takes its
    // *palette* from the landing (x-system.ts), which was rebuilt to a white
    // ground and pure black ink. This screen is the seam between the marketing
    // site and the workspace, and a seam is where an inversion shows most.
    expect(surface).toHaveClass("min-h-[100dvh]", "bg-[var(--pa-ground)]");
    expect(nativeDragStrip).toHaveAttribute("data-tauri-drag-region");
    expect(nativeDragStrip).toHaveClass("rift-native-window-drag-strip");
    // 16/24, not 13. The old base was a marketing page's type on the last
    // screen before the workspace; the measured product base is 16 on a 24
    // line. The typeface comes from `PRIME_TOKENS` rather than a `font-sans`
    // class, because the whole surface switches to IBM Plex.
    expect(surface).toHaveClass("text-[16px]", "font-normal", "leading-[24px]");
    // The `--pa-*` names are kept and repointed at the landing's values, so
    // the surface flips in one place rather than in every class that reads it.
    expect(surface).toHaveStyle({
      "--background": "#ffffff",
      "--foreground": "#000000",
      "--pa-ground": "var(--x-ground)",
      "--pa-ink": "var(--x-ink)",
    });
    expect(preview.querySelector("video")).not.toBeInTheDocument();
    expect(
      within(preview).getByRole("img", {
        name: /finished creative studio application/i,
      }),
    ).toHaveAttribute(
      "src",
      expect.stringContaining("application-studio-4k.webp"),
    );
    expect(screen.queryByText(/product film/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/rift workspace/i)).not.toBeInTheDocument();
    // The shell's own chrome moved to the measured scale with the form: a
    // secondary link and the footer both sit at 14/20 in the muted tone.
    expect(screen.getByRole("link", { name: "Back home" })).toHaveClass(
      "text-[14px]",
      "text-[var(--pa-muted)]",
    );
    expect(screen.getByRole("contentinfo")).toHaveClass(
      "text-[14px]",
      "font-normal",
      "text-[var(--pa-muted)]",
    );
    expect(preview).not.toHaveTextContent(/testimonial|customer|trusted by/i);
    expect(preview.textContent).not.toMatch(/[—–]/);
  });

  it("closes the landing's loop with the resolving mark, not a stock portrait", () => {
    render(
      <ZauthPageShell variant="auth" authVisual="login-artwork">
        <div>Account form</div>
      </ZauthPageShell>,
    );

    const preview = screen.getByRole("complementary", {
      name: "What RIFT does",
    });
    const layout = document.querySelector('[data-auth-layout="full-bleed"]');
    const split = layout?.firstElementChild;

    expect(layout).toHaveClass("min-h-[100dvh]", "w-full");
    expect(layout).not.toHaveClass("max-w-[1600px]", "md:p-4", "lg:p-6");
    expect(split).toHaveClass("lg:grid-cols-2");
    expect(preview).toHaveAttribute("data-auth-visual", "login-artwork");
    expect(preview).not.toHaveClass("m-4", "rounded-[18px]", "border");

    // The 4K monochrome portrait captioned "Create with no limitations" is
    // gone. It was a good image from a different product: nothing on it was
    // RIFT, and it met a visitor arriving from a page they had just scrolled.
    expect(preview.querySelector("img")).not.toBeInTheDocument();
    expect(preview.textContent).not.toMatch(/create with no limitations/i);

    // What replaces it is the landing's own closing frame — the mark
    // rasterised into a grid and resolved — over the same claim the hero
    // makes, so the two screens read as one product.
    expect(preview.querySelector("canvas")).toBeInTheDocument();
    expect(preview).toHaveTextContent(/give it the work/i);
    expect(preview).toHaveTextContent(/sandbox/i);
  });

  it("gives login and signup a focused form without an artwork panel", () => {
    const login = render(<LoginSurface />);
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
    expect(
      login.container.querySelector('[data-auth-surface="minimal"]'),
    ).toBeInTheDocument();
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "RIFT home" })).toBeInTheDocument();
    login.unmount();
    render(<SignupPage />);
    expect(
      screen.getByRole("button", { name: "Create account" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
  });

  it("keeps one accessible auth-home label and an enlarged visual brand", () => {
    render(
      <ZauthPageShell variant="auth">
        <div>Account form</div>
      </ZauthPageShell>,
    );

    const home = screen.getByRole("link", { name: "RIFT home" });
    const visualBrand = home.querySelector('[aria-hidden="true"]');
    expect(visualBrand).toBeInTheDocument();
    expect(visualBrand?.tagName).toBe("svg");
    expect(visualBrand).toHaveAttribute("height", "35");
    expect(visualBrand).toHaveAttribute("viewBox", "0 0 428 152");
    expect(visualBrand?.querySelectorAll("path")).toHaveLength(6);
    expect(visualBrand).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByRole("contentinfo")).toContainElement(
      screen.getByRole("img", { name: "RIFT" }),
    );
  });

  it("server-renders the application preview without video or status motion", () => {
    const serverMarkup = renderToString(
      <ZauthPageShell variant="auth">
        <div>Account form</div>
      </ZauthPageShell>,
    );

    expect(serverMarkup).toContain("application-studio-4k.webp");
    expect(serverMarkup).not.toContain("<video");
    expect(serverMarkup).toContain("<img");

    setReducedMotion(true);
    render(
      <ZauthPageShell variant="auth">
        <div>Account form</div>
      </ZauthPageShell>,
    );

    const preview = screen.getByRole("complementary", {
      name: "Creative studio application preview",
    });
    expect(preview.querySelector("video")).not.toBeInTheDocument();
    expect(preview.querySelector(".animate-spin")).not.toBeInTheDocument();
  });

  it("announces the verification step and moves focus to its code input", async () => {
    mockSignIn.mockResolvedValueOnce({ signingIn: false });
    const user = userEvent.setup();
    render(<AuthForm flow="signUp" />);

    await user.type(screen.getByLabelText("Email"), "person@example.com");
    await user.type(screen.getByLabelText("Password"), "safe-password");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    const verificationCode = await screen.findByLabelText("Verification code");
    expect(verificationCode).toHaveFocus();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Verification step. Enter the six-digit code sent to person@example.com.",
    );
  });

  it("associates form and verification errors with their affected inputs", async () => {
    mockSignIn
      .mockResolvedValueOnce({ signingIn: false })
      .mockRejectedValueOnce(new Error("Invalid verification code"));
    const user = userEvent.setup();
    render(<AuthForm flow="signUp" />);

    await user.type(screen.getByLabelText("Email"), "person@example.com");
    await user.type(screen.getByLabelText("Password"), "safe-password");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    const verificationCode = await screen.findByLabelText("Verification code");
    await user.type(verificationCode, "000000");
    await user.click(
      screen.getByRole("button", { name: "Verify and continue" }),
    );

    const verificationError = await screen.findByRole("alert");
    expect(verificationError).toHaveAttribute("id", "verification-error");
    expect(verificationCode).toHaveAttribute(
      "aria-describedby",
      "verification-error",
    );

    mockSignIn.mockRejectedValueOnce(new Error("Invalid password"));
    await user.click(screen.getByRole("button", { name: "Back" }));
    await user.type(screen.getByLabelText("Email"), "person@example.com");
    await user.type(screen.getByLabelText("Password"), "safe-password");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    const formError = await screen.findByRole("alert");
    expect(formError).toHaveAttribute("id", "auth-form-error");
    expect(screen.getByLabelText("Email")).toHaveAttribute(
      "aria-describedby",
      "auth-form-error",
    );
    expect(screen.getByLabelText("Password")).toHaveAttribute(
      "aria-describedby",
      "auth-form-error",
    );
  });

  it("keeps the measured ergonomics and takes its tone from the landing", () => {
    render(<AuthForm flow="signIn" />);

    const primary = screen.getByRole("button", { name: "Sign in" });
    const google = screen.getByRole("button", {
      name: "Continue with Google",
    });

    const email = screen.getByLabelText("Email");
    const emailLabel = screen.getByText("Email");
    const intro = screen.getByText(
      "Pick up your runs, builds and renders where you left them.",
    );
    const separator = screen.getByText("or");
    const footerCopy = screen.getByText(/New to RIFT/).closest("p");

    // Two systems meet on this screen and the split is deliberate.
    //
    // ERGONOMICS stay measured (prime-scale.ts): a 44px field, its value at
    // 14/20, secondary copy in the muted tone. Those numbers survived the
    // redesign because they are about the hand, not the eye.
    //
    // TONE comes from the landing (x-system.ts), because this is the screen
    // immediately after it: Geist at weight 500 pulled in by -0.025em, a
    // 0.5px hairline instead of a 1px border, a white field rather than a
    // raised grey (on paper a filled field reads as disabled), a full-radius
    // pill instead of a 6px rectangle, and a 2px black focus *outline* where
    // every ring on this surface used to be white-on-black.
    expect(email).toHaveClass(
      "h-11",
      "text-[14px]",
      "font-normal",
      "leading-[20px]",
      "text-[var(--pa-ink)]",
      "rounded-[10px]",
      "border-[0.5px]",
      "bg-[var(--pa-ground)]",
      "placeholder:text-[var(--pa-faint)]",
      "focus-visible:outline-[var(--pa-ink)]",
    );
    expect(emailLabel).toHaveClass(
      "text-[13px]",
      "font-medium",
      "text-[var(--pa-ink)]",
    );
    expect(intro).toHaveClass("text-[15px]", "text-[var(--pa-muted)]");
    expect(separator).toHaveClass("text-[12px]", "text-[var(--pa-muted)]");
    expect(primary).toHaveClass(
      "h-11",
      "rounded-full",
      "bg-[var(--pa-ink)]",
      "text-[14px]",
      "font-medium",
      "text-[var(--pa-ground)]",
      "focus-visible:outline-[var(--pa-ink)]",
    );
    expect(google).toHaveClass(
      "h-11",
      "rounded-full",
      "border-[0.5px]",
      "border-[var(--pa-line-soft)]",
      "text-[14px]",
      "font-medium",
      "text-[var(--pa-ink)]",
    );
    expect(footerCopy).toHaveClass(
      "text-[14px]",
      "font-normal",
      "text-[var(--pa-muted)]",
    );

    // The one-click path comes before the two fields it saves people filling.
    expect(google.compareDocumentPosition(email)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );

    // No leftovers from the dark surface: a white focus ring on a white
    // ground is invisible, which is a failure that renders as nothing at all.
    expect(document.body.innerHTML).not.toContain("ring-white");
    expect(document.body.innerHTML).not.toContain("#00d3f5");
  });
});
