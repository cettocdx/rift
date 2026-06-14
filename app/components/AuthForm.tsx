"use client";

import React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuthActions } from "@convex-dev/auth/react";
import { Button } from "@/components/ui/button";
import { RiftLogo } from "@/components/icons/rift-logo";
import DottedWordmark from "./DottedWordmark";

/**
 * zauth-styled email/password auth form, backed by Convex Auth's Password
 * provider. `flow` switches between sign-in and sign-up.
 */
export default function AuthForm({ flow }: { flow: "signIn" | "signUp" }) {
  const { signIn } = useAuthActions();
  const router = useRouter();
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const isSignUp = flow === "signUp";

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const form = new FormData(e.currentTarget);
    form.set("flow", flow);
    try {
      await signIn("password", form);
      router.push("/");
    } catch (err) {
      const msg =
        err instanceof Error && /invalid|password|account/i.test(err.message)
          ? isSignUp
            ? "Could not create account. The email may already be in use."
            : "Invalid email or password."
          : "Something went wrong. Please try again.";
      setError(msg);
      setSubmitting(false);
    }
  };

  return (
    <div className="w-full max-w-sm">
      <div className="mb-10 flex items-center gap-2.5">
        <RiftLogo size={28} className="text-primary text-rift-glow" />
        <DottedWordmark
          word="RIFT"
          animate={false}
          fill="#e8f2fb"
          className="h-[18px] w-auto"
        />
      </div>

      <h1 className="font-display text-4xl font-semibold tracking-tight text-foreground">
        {isSignUp ? (
          <>
            Create your <span className="text-gradient">account</span>.
          </>
        ) : (
          <>
            Welcome <span className="text-gradient">back</span>.
          </>
        )}
      </h1>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        {isSignUp
          ? "Start mapping breaches before they open."
          : "Sign in to continue to your operations."}
      </p>

      <form onSubmit={handleSubmit} className="glass-panel mt-8 p-6 glow-soft">
        <label className="block">
          <span className="hud-label">Email</span>
          <input
            name="email"
            type="email"
            autoComplete="email"
            required
            placeholder="operator@rift.sh"
            className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-foreground outline-none transition-all placeholder:text-muted-foreground/60 hover:bg-white/[0.06] focus:border-primary/60 focus:bg-white/[0.07] focus:ring-2 focus:ring-primary/20"
          />
        </label>

        <label className="mt-4 block">
          <span className="hud-label">Password</span>
          <input
            name="password"
            type="password"
            autoComplete={isSignUp ? "new-password" : "current-password"}
            required
            minLength={8}
            placeholder="••••••••"
            className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-foreground outline-none transition-all placeholder:text-muted-foreground/60 hover:bg-white/[0.06] focus:border-primary/60 focus:bg-white/[0.07] focus:ring-2 focus:ring-primary/20"
          />
        </label>

        {error && (
          <p className="mt-4 text-sm text-destructive" role="alert">
            {error}
          </p>
        )}

        <Button
          type="submit"
          disabled={submitting}
          size="lg"
          className="mt-6 w-full"
        >
          {submitting
            ? "Please wait…"
            : isSignUp
              ? "Create account"
              : "Sign in"}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        {isSignUp ? (
          <>
            Already have an account?{" "}
            <Link
              href="/login"
              className="text-link underline underline-offset-4 hover:text-primary"
            >
              Sign in
            </Link>
          </>
        ) : (
          <>
            New to RIFT?{" "}
            <Link
              href="/signup"
              className="text-link underline underline-offset-4 hover:text-primary"
            >
              Create an account
            </Link>
          </>
        )}
      </p>
    </div>
  );
}
