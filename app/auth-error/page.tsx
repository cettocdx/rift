import { AlertCircle, RefreshCw, Home } from "lucide-react";
import Link from "next/link";
import ZauthPageShell from "@/app/components/ZauthPageShell";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
} from "@/components/ui/card";
import { AutoRetryButton } from "./auto-retry-button";

type ErrorCode = "429" | "401" | "403" | "500" | "502" | "503" | "504";

const ERROR_MESSAGES: Record<
  ErrorCode,
  { title: string; description: string; autoRetry?: boolean }
> = {
  "429": {
    title: "Too Many Requests",
    description:
      "Too many login attempts. Please wait a moment before trying again.",
  },
  "401": {
    title: "Session Expired",
    description:
      "Your session has expired or the login link is no longer valid. Please sign in again.",
  },
  "403": {
    title: "Access Denied",
    description:
      "You don't have permission to access this resource. Please sign in with a different account.",
  },
  "500": {
    title: "Authentication Failed",
    description:
      "Something went wrong during sign in. This can happen when multiple browser tabs try to authenticate at the same time.",
    autoRetry: true,
  },
  "502": {
    title: "Service Unavailable",
    description:
      "Our authentication service is temporarily unavailable. Please try again in a few minutes.",
  },
  "503": {
    title: "Service Unavailable",
    description:
      "Our authentication service is temporarily unavailable. Please try again in a few minutes.",
  },
  "504": {
    title: "Request Timeout",
    description:
      "The authentication request timed out. Please check your connection and try again.",
  },
};

const DEFAULT_ERROR = {
  title: "Authentication Error",
  description: "An unexpected error occurred during sign in. Please try again.",
};

type SearchParams = Promise<{ code?: string }>;

export default async function AuthErrorPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { code } = await searchParams;
  const errorInfo = ERROR_MESSAGES[code as ErrorCode] ?? DEFAULT_ERROR;

  return (
    <ZauthPageShell header={false} center>
      <Card className="w-full max-w-md rounded-[16px] border-[0.5px] border-[var(--x-line-soft)] bg-[var(--x-ground)] shadow-none">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[#b42318]/10">
            <AlertCircle className="h-6 w-6 text-[#b42318]" />
          </div>
          <h1 className="text-[20px] font-medium leading-none tracking-[-0.025em] text-[var(--x-ink)]">
            {errorInfo.title}
          </h1>
          <CardDescription className="mt-3 text-[15px] leading-[23px] text-[var(--x-ink-45)]">
            {errorInfo.description}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {code && (
            <p className="text-center font-mono text-[12px] uppercase tracking-[0.06em] text-[var(--x-ink-45)]">
              Error code: {code}
            </p>
          )}
        </CardContent>
        <CardFooter className="flex flex-col gap-3 sm:flex-row w-full">
          {errorInfo.autoRetry ? (
            <AutoRetryButton loginUrl="/login" />
          ) : (
            <Button
              asChild
              className="min-w-0 flex-1 rounded-full bg-[var(--x-ink)] text-[var(--x-ground)] shadow-none hover:bg-[#262626]"
            >
              <a href="/login">
                <RefreshCw className="h-4 w-4" />
                Try Again
              </a>
            </Button>
          )}
          <Button
            asChild
            variant="outline"
            // The `dark:` half of shadcn's outline variant has to be answered
              // explicitly. The application root carries the `dark` class, so
              // `dark:bg-input/30` still applies on this page and painted the
              // button a solid grey on a white ground.
              className="min-w-0 flex-1 rounded-full border-[0.5px] border-[var(--x-line-soft)] bg-transparent text-[var(--x-ink)] shadow-none hover:bg-[var(--x-raise)] dark:border-[var(--x-line-soft)] dark:bg-transparent dark:hover:bg-[var(--x-raise)]"
          >
            <Link href="/">
              <Home className="h-4 w-4" />
              Go Home
            </Link>
          </Button>
        </CardFooter>
      </Card>
    </ZauthPageShell>
  );
}
