import type { Metadata } from "next";
import MinimalAuthShell from "@/app/components/MinimalAuthShell";
import AuthForm from "@/app/components/AuthForm";

export const metadata: Metadata = {
  title: "Sign up | RIFT",
  description: "Create your RIFT account.",
};

export default function SignupPage() {
  return (
    <MinimalAuthShell>
      <AuthForm flow="signUp" />
    </MinimalAuthShell>
  );
}
