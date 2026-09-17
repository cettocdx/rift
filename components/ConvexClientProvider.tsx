"use client";

import { ReactNode, useState } from "react";
import { ConvexReactClient } from "convex/react";
import { ConvexAuthNextjsProvider } from "@convex-dev/auth/nextjs";
import { OAuthCodeHandler } from "@/app/components/OAuthCodeHandler";

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  const [convex] = useState(
    () => new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!),
  );

  return (
    <ConvexAuthNextjsProvider client={convex}>
      {/* Completes the Google OAuth `?code=` exchange (the library skips it
          under ConvexAuthNextjsServerProvider + our custom /api/auth route). */}
      <OAuthCodeHandler />
      {children}
    </ConvexAuthNextjsProvider>
  );
}
