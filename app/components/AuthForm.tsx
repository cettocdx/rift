"use client";

import React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useAuthActions } from "@convex-dev/auth/react";
import { ArrowRight } from "lucide-react";
import { sanitizeAppRedirectPath } from "@/lib/routing/safe-app-redirect";

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-[18px] shrink-0" aria-hidden>
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1Z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38Z"
      />
    </svg>
  );
}

// AppleIcon — restore alongside the Apple sign-in button once Apple is enabled.
// function AppleIcon() { ... }

/**
 * Auth — Google / Apple OAuth + email/password with an emailed verification
 * code (so fake / non-existent email addresses cannot create an account).
 */
export default function AuthForm({ flow }: { flow: "signIn" | "signUp" }) {
  const { signIn } = useAuthActions();
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = sanitizeAppRedirectPath(searchParams.get("redirect"));
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [step, setStep] = React.useState<"form" | "verify">("form");
  const [pending, setPending] = React.useState<{
    email: string;
    password: string;
  } | null>(null);
  const [cooldown, setCooldown] = React.useState(0);
  const verificationInputRef = React.useRef<HTMLInputElement>(null);

  const isSignUp = flow === "signUp";
  const authSwitchPath = isSignUp ? "/login" : "/signup";
  const authSwitchHref =
    redirectTo === "/"
      ? authSwitchPath
      : `${authSwitchPath}?${new URLSearchParams({ redirect: redirectTo }).toString()}`;

  React.useEffect(() => {
    if (step !== "verify") return;
    verificationInputRef.current?.focus();
  }, [step]);

  // Tick the resend cooldown down to zero.
  React.useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const oauth = async (provider: "google" | "apple") => {
    setError(null);
    try {
      await signIn(provider, { redirectTo });
    } catch {
      setError("Couldn't start sign-in. Please try again.");
    }
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const form = new FormData(e.currentTarget);
    form.set("flow", flow);
    const email = String(form.get("email") ?? "");
    const password = String(form.get("password") ?? "");
    try {
      const res = await signIn("password", form);
      // With email verification, sign-up does NOT sign in immediately — a code
      // was emailed and must be entered. (`signingIn === false`)
      if (isSignUp && res && res.signingIn === false) {
        setPending({ email, password });
        setStep("verify");
        setSubmitting(false);
        return;
      }
      router.push(redirectTo);
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      const isRateLimited = /too many|please wait|being sent right now/i.test(
        raw,
      );
      const isCredentialError =
        /invalid|account|secret|password|credential/i.test(raw);
      const isDisposable = /disposable/i.test(raw);
      setError(
        isDisposable
          ? "Disposable email addresses aren't allowed. Use a real inbox."
          : // Server-side OTP rate limit — the message is already user-facing.
            isRateLimited
            ? raw
            : isCredentialError
              ? isSignUp
                ? "Couldn't create the account. Check your details."
                : "Invalid email or password."
              : "Something went wrong. Please try again.",
      );
      setSubmitting(false);
    }
  };

  const handleVerify = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!pending) return;
    setError(null);
    setSubmitting(true);
    const form = new FormData(e.currentTarget);
    form.set("email", pending.email);
    form.set("flow", "email-verification");
    try {
      await signIn("password", form);
      router.push(redirectTo);
    } catch {
      setError("That code didn't match. Check it and try again.");
      setSubmitting(false);
    }
  };

  const resend = async () => {
    if (!pending || cooldown > 0) return;
    setError(null);
    setCooldown(60); // server still gates delivery; this just curbs spam clicks
    const form = new FormData();
    form.set("email", pending.email);
    form.set("password", pending.password);
    form.set("flow", "signUp");
    try {
      await signIn("password", form);
    } catch {
      /* ignore — a fresh code is sent if the address is valid */
    }
  };

  /*
   * The landing's controls, at form scale.
   *
   * ── What changed, and the one number that did not ──
   *
   * The 44px field height, the 14/20 value inside it and the 12/16 button
   * label are still the measured product scale from prime-scale.ts — those are
   * ergonomics, and they survived the palette change unchanged.
   *
   * Everything that carries *tone* now comes from x-system.ts, because this is
   * the screen immediately after the landing page. Concretely: the fill is
   * white rather than a raised grey (on paper a filled field reads as disabled
   * — the reference outlines instead), the border is the landing's 0.5px
   * hairline, the corner is 10px instead of 6, the focus state is a 2px black
   * outline rather than a white ring, and the primary control is the landing's
   * filled pill instead of a square button. A visitor who just clicked "Log in"
   * in the landing nav clicks a button of the same shape here.
   *
   * The autofill override is not cosmetic either: Chrome paints a pale
   * blue over a field it filled, which was invisible on the old dark form
   * and is the loudest thing on the screen on a white one. The background
   * is not overridable — a 1000px inset box-shadow is the only cover that
   * works — and the text needs `-webkit-text-fill-color`, not `color`.
   *
   * The placeholder is `--x-ink-30`, which is 3.4:1 on white — deliberately
   * below the 4.5:1 floor because placeholder text here is *example* text, not
   * content: every field carries a real `<label>` above it, and the hint
   * disappears the moment anyone types. Raising it to pass would make the
   * example compete with the value.
   */
  const inputCls =
    "mt-2 h-11 w-full rounded-[10px] border-[0.5px] border-[var(--pa-line-soft)] bg-[var(--pa-ground)] px-3.5 text-[14px] max-sm:text-[16px] font-normal leading-[20px] tracking-[-0.01em] text-[var(--pa-ink)] outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-[var(--pa-faint)] hover:border-[var(--pa-border-hover,rgba(0,0,0,0.30))] focus-visible:border-[var(--pa-ink)] focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--pa-ink)] disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none [&:-webkit-autofill]:shadow-[inset_0_0_0_1000px_var(--pa-ground)] [&:-webkit-autofill]:[-webkit-text-fill-color:var(--pa-ink)] [&:-webkit-autofill]:[caret-color:var(--pa-ink)]";
  const labelCls =
    "text-[13px] font-medium leading-[18px] tracking-[-0.01em] text-[var(--pa-ink)]";
  const primaryButtonCls =
    "flex h-11 w-full items-center justify-center gap-1.5 rounded-full bg-[var(--pa-ink)] px-4 text-[14px] font-medium leading-5 text-[var(--pa-ground)] transition-[transform,background-color] duration-150 hover:bg-[var(--pa-primary-hover,#262626)] active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--pa-ink)] disabled:cursor-not-allowed disabled:opacity-45 motion-reduce:transition-none";
  const secondaryButtonCls =
    "flex h-11 w-full items-center justify-center gap-2.5 rounded-full border-[0.5px] border-[var(--pa-line-soft)] px-4 text-[14px] font-medium leading-5 text-[var(--pa-ink)] transition-[transform,background-color] duration-150 hover:bg-[var(--pa-surface-soft)] active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--pa-ink)] motion-reduce:transition-none";
  const quietButtonCls =
    "rounded-[6px] text-[14px] font-normal leading-[20px] text-[var(--pa-muted)] transition-colors hover:text-[var(--pa-ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--pa-ink)]";
  // The one non-monochrome value on the surface, and it earns it: an error is
  // the only thing here a person must not miss. 5.9:1 on white.
  const errorCls =
    "mt-4 text-[13px] leading-[18px] text-[var(--pa-error,#b42318)]";

  return (
    <div className="relative w-full">
      <div
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {step === "verify"
          ? `Verification step. Enter the six-digit code sent to ${pending?.email ?? "your inbox"}.`
          : ""}
      </div>

      <div className="mb-9 text-left">
        <h1
          id="auth-step-heading"
          // The landing's section step — 28/32 at weight 500, pulled in by
          // -0.025em. It replaced a 30/600 at normal tracking, which is the
          // product-UI heading; on this screen the heading is the first thing
          // after a landing page set in exactly this face and tracking.
          className="text-balance text-[26px] font-medium leading-[1.1] tracking-[-0.025em] text-[var(--pa-ink)] sm:text-[30px]"
        >
          {step === "verify"
            ? "Verify your email"
            : isSignUp
              ? "Create your account"
              : "Welcome back"}
        </h1>
        {step === "verify" ? (
          <p className="mt-3 max-w-[380px] text-pretty text-[15px] font-normal leading-[23px] text-[var(--pa-muted)]">
            Enter the six-digit code sent to{" "}
            <span className="break-all text-[var(--pa-ink)]">
              {pending?.email ?? "your inbox"}
            </span>
            .
          </p>
        ) : (
          <p className="mt-3 max-w-[380px] text-pretty text-[15px] font-normal leading-[23px] text-[var(--pa-muted)]">
            {isSignUp
              ? "Your first run is free. No credit card, no install."
              : "Pick up your runs, builds and renders where you left them."}
          </p>
        )}
      </div>

      {step === "verify" ? (
        <form
          onSubmit={handleVerify}
          aria-busy={submitting}
          aria-labelledby="auth-step-heading"
        >
          <label htmlFor="verification-code" className={labelCls}>
            Verification code
          </label>
          <input
            ref={verificationInputRef}
            id="verification-code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            placeholder="123456"
            aria-invalid={Boolean(error)}
            aria-describedby={error ? "verification-error" : undefined}
            className={`${inputCls} text-center font-mono tracking-[0.4em]`}
          />

          {error ? (
            <p id="verification-error" className={errorCls} role="alert">
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={submitting}
            className={`mt-6 ${primaryButtonCls}`}
          >
            {submitting ? "Verifying…" : "Verify and continue"}
          </button>

          <div className="mt-5 flex items-center justify-between">
            <button
              type="button"
              onClick={() => {
                setStep("form");
                setError(null);
              }}
              className={quietButtonCls}
            >
              Back
            </button>
            <button
              type="button"
              onClick={resend}
              disabled={cooldown > 0}
              className={`${quietButtonCls} disabled:cursor-not-allowed disabled:opacity-50`}
            >
              {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
            </button>
          </div>
        </form>
      ) : (
        <div>
          {/*
           * Google first, then the divider, then the fields.
           *
           * The order is reversed from what shipped here before, and it is the
           * order every reference on this page's shelf uses: the one-click
           * path is the one most people take, and putting two text fields
           * above it makes them read the form before finding out they did not
           * have to fill it in.
           */}
          <button
            type="button"
            onClick={() => oauth("google")}
            className={secondaryButtonCls}
          >
            <GoogleIcon />
            Continue with Google
          </button>

          <div className="my-6 flex items-center gap-3" aria-hidden="true">
            <span className="h-px flex-1 bg-[var(--pa-line)]" />
            <span className="text-[12px] font-normal leading-[16px] text-[var(--pa-muted)]">
              or
            </span>
            <span className="h-px flex-1 bg-[var(--pa-line)]" />
          </div>

          <form
            onSubmit={handleSubmit}
            aria-busy={submitting}
            aria-labelledby="auth-step-heading"
          >
            <div>
              <label htmlFor="auth-email" className={labelCls}>
                Email
              </label>
              <input
                id="auth-email"
                name="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                autoCapitalize="none"
                spellCheck={false}
                required
                placeholder="you@company.com"
                aria-invalid={Boolean(error)}
                aria-describedby={error ? "auth-form-error" : undefined}
                className={inputCls}
              />
            </div>

            <div className="mt-4">
              <label htmlFor="auth-password" className={labelCls}>
                Password
              </label>
              <input
                id="auth-password"
                name="password"
                type="password"
                autoComplete={isSignUp ? "new-password" : "current-password"}
                required
                minLength={8}
                placeholder="At least 8 characters"
                aria-invalid={Boolean(error)}
                aria-describedby={error ? "auth-form-error" : undefined}
                className={inputCls}
              />
            </div>

            {error ? (
              <p id="auth-form-error" className={errorCls} role="alert">
                {error}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={submitting}
              className={`mt-6 ${primaryButtonCls}`}
            >
              {submitting ? (
                "Please wait…"
              ) : (
                <>
                  {isSignUp ? "Create account" : "Sign in"}
                  <ArrowRight className="size-4" />
                </>
              )}
            </button>
          </form>

          {/* Apple sign-in can return here when the provider is enabled. */}
        </div>
      )}

      <p className="mt-8 border-t-[0.5px] border-t-[var(--pa-line)] pt-6 text-left text-[14px] font-normal leading-[20px] text-[var(--pa-muted)]">
        {isSignUp ? (
          <>
            Already have an account?{" "}
            <Link
              href={authSwitchHref}
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-[6px] font-medium text-[var(--pa-ink)] underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--pa-ink)]"
            >
              Sign in
            </Link>
          </>
        ) : (
          <>
            New to RIFT?{" "}
            <Link
              href={authSwitchHref}
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-[6px] font-medium text-[var(--pa-ink)] underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--pa-ink)]"
            >
              Create an account
            </Link>
          </>
        )}
      </p>
    </div>
  );
}
