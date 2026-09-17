import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { LoginSurface } from "./LoginSurface";
import { convexAuthCookieName } from "@/lib/auth/convex-auth-cookies";

export const metadata: Metadata = {
  title: "Log in | RIFT",
  description: "Sign in to RIFT.",
};

/**
 * A signed-in visitor is sent to the app instead of a sign-in form.
 *
 * The desktop wrapper opens this route on every launch, so without the
 * redirect it greets a signed-in user with a login screen and the session
 * looks lost when it is not -- the auth cookie is good for thirty days.
 *
 * Reading the cookie is enough to route on, and deliberately not enough to
 * trust: the destination's own loaders verify it against Convex, and a stale
 * cookie is bounced straight back here. Verifying here as well would put a
 * network round trip in front of every anonymous visit to the sign-in page.
 */
export default async function LoginPage() {
  const cookieStore = await cookies();
  const isLocalhost = process.env.NODE_ENV !== "production";
  if (cookieStore.get(convexAuthCookieName("token", isLocalhost))?.value) {
    redirect("/");
  }

  return <LoginSurface />;
}
