import MinimalAuthShell from "@/app/components/MinimalAuthShell";
import AuthForm from "@/app/components/AuthForm";

/**
 * The sign-in page's rendered half.
 *
 * It lives outside `page.tsx` because that file is an async server component
 * that reads request cookies -- a renderer cannot mount it, and a route file
 * may not carry extra named exports for a test to reach past the default.
 */
export function LoginSurface() {
  return (
    <MinimalAuthShell>
      <AuthForm flow="signIn" />
    </MinimalAuthShell>
  );
}
