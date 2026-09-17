import type { Metadata } from "next";
import Link from "next/link";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import ZauthPageShell from "@/app/components/ZauthPageShell";
import {
  isLocalAuthHost,
  readConvexAuthCookies,
} from "@/lib/auth/convex-auth-cookies";
import { getUserID } from "@/lib/auth/get-user-id";
import { createDesktopTransferToken } from "@/lib/desktop-auth";
import {
  buildDesktopLoginReturnPath,
  buildDesktopNativeCallbackUrl,
  hasDesktopOAuthCode,
  parseDesktopLoginRequest,
  resolveDesktopAppOrigin,
  type DesktopLoginSearchParams,
} from "@/lib/desktop-auth-flow";
import { sealDesktopAuthSession } from "@/lib/desktop-auth-session";

export const metadata: Metadata = {
  title: "Desktop sign in | RIFT",
  robots: { index: false, follow: false },
};

function DesktopAuthError({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <ZauthPageShell header={false} center>
      <section
        role="alert"
        className="w-full max-w-md rounded-[16px] border-[0.5px] border-[var(--x-line-soft)] px-7 py-8 text-left text-[var(--x-ink)]"
      >
        <h1 className="text-[20px] font-medium tracking-[-0.025em]">{title}</h1>
        <p className="mt-3 text-[15px] leading-[23px] text-[var(--x-ink-45)]">
          {description}
        </p>
        <Link
          href="/login"
          className="mt-7 inline-flex h-10 items-center rounded-full bg-[var(--x-ink)] px-4.5 text-[14px] font-medium text-[var(--x-ground)] transition-colors hover:bg-[#262626] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--x-ink)]"
        >
          Return to sign in
        </Link>
      </section>
    </ZauthPageShell>
  );
}

function DesktopAuthFinishing() {
  return (
    <ZauthPageShell header={false} center>
      <section
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="w-full max-w-md rounded-[16px] border-[0.5px] border-[var(--x-line-soft)] px-7 py-8 text-left text-[var(--x-ink)]"
      >
        <h1 className="text-[20px] font-medium tracking-[-0.025em]">
          Finishing desktop sign-in
        </h1>
        <p className="mt-3 text-[15px] leading-[23px] text-[var(--x-ink-45)]">
          Keep this tab open while RIFT securely connects your desktop app.
        </p>
      </section>
    </ZauthPageShell>
  );
}

export default async function DesktopLoginPage({
  searchParams,
}: {
  searchParams: Promise<DesktopLoginSearchParams>;
}) {
  const resolvedSearchParams = await searchParams;
  const request = parseDesktopLoginRequest(resolvedSearchParams);
  if (!request) {
    return (
      <DesktopAuthError
        title="Desktop sign-in request expired"
        description="Return to the RIFT desktop app and start sign in again. The desktop state must come from the app."
      />
    );
  }

  // OAuth returns to this route with a one-time code before auth cookies exist.
  // Stay on the route so the global OAuthCodeHandler can exchange it, then reload
  // the cleaned /desktop-login URL and continue the native session transfer.
  if (hasDesktopOAuthCode(resolvedSearchParams)) {
    return <DesktopAuthFinishing />;
  }

  const headerStore = await headers();
  const requestHost = headerStore.get("host") ?? undefined;
  const isLocalhost = isLocalAuthHost(requestHost ?? null);
  const cookieStore = await cookies();
  const tokens = readConvexAuthCookies(cookieStore, isLocalhost);

  if (!tokens) {
    const entryPath = request.screenHint === "sign-up" ? "/signup" : "/login";
    const returnPath = buildDesktopLoginReturnPath(request);
    redirect(`${entryPath}?redirect=${encodeURIComponent(returnPath)}`);
  }

  try {
    await getUserID();
  } catch {
    return (
      <DesktopAuthError
        title="Desktop sign-in could not be verified"
        description="Your browser session is no longer valid. Sign in again, then restart the desktop connection."
      />
    );
  }

  const origin = resolveDesktopAppOrigin({
    configuredOrigin:
      process.env.NEXT_PUBLIC_BASE_URL ?? process.env.NEXT_PUBLIC_APP_URL,
    requestHost,
    forwardedProtocol: headerStore
      .get("x-forwarded-proto")
      ?.split(",")[0]
      ?.trim(),
    production: process.env.NODE_ENV === "production",
  });
  if (!origin) {
    return (
      <DesktopAuthError
        title="Desktop sign-in is unavailable"
        description="The application origin is not configured for secure desktop authentication."
      />
    );
  }

  const sealedSession = await sealDesktopAuthSession(tokens);
  if (!sealedSession) {
    return (
      <DesktopAuthError
        title="Desktop sign-in is unavailable"
        description="The secure session transfer could not be prepared. Try again in a moment."
      />
    );
  }

  const transferToken = await createDesktopTransferToken(sealedSession, {
    desktopAuthState: request.desktopAuthState,
    returnPath: request.returnPath,
  });
  if (!transferToken) {
    return (
      <DesktopAuthError
        title="Desktop sign-in is unavailable"
        description="The one-time desktop connection could not be created. Try again in a moment."
      />
    );
  }

  const callbackUrl = buildDesktopNativeCallbackUrl({
    transferToken,
    request,
    origin,
  });
  if (!callbackUrl) {
    return (
      <DesktopAuthError
        title="Desktop sign-in could not continue"
        description="The desktop callback was rejected. Return to the desktop app and start again."
      />
    );
  }

  redirect(callbackUrl);
}
