"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { LockKeyhole } from "lucide-react";
import { Button } from "@/components/ui/button";
import { sanitizeAppRedirectPath } from "@/lib/routing/safe-app-redirect";

export function ProtectedPageSignIn({ resource }: { resource: string }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = searchParams.toString();
  const returnPath = sanitizeAppRedirectPath(
    `${pathname}${query ? `?${query}` : ""}`,
  );
  const href = `/login?${new URLSearchParams({ redirect: returnPath })}`;

  return (
    <main className="flex h-full min-h-[60dvh] items-center justify-center bg-background px-5 py-12">
      <div className="w-full max-w-md rounded-md border border-border/80 bg-card/[0.18] px-6 py-8 text-center">
        <div className="mx-auto flex size-9 items-center justify-center rounded-md border border-border/80 bg-background text-muted-foreground">
          <LockKeyhole className="size-[18px]" strokeWidth={1.6} aria-hidden />
        </div>
        <h1 className="mt-4 text-ui-title font-medium text-foreground">
          Sign in to open {resource}
        </h1>
        <p className="mt-1.5 text-ui leading-6 text-muted-foreground">
          This workspace is private to your RIFT account.
        </p>
        <Button asChild size="sm" className="mt-5 h-8 rounded-md text-ui">
          <Link href={href}>Go to sign in</Link>
        </Button>
      </div>
    </main>
  );
}
