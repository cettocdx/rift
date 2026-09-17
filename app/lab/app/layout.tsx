"use client";

import { RootShellPresence } from "@/app/components/RootShellPresence";

import { Authenticated, Unauthenticated, AuthLoading } from "convex/react";
import { ProShellProvider } from "@/app/components/pro/ProShellContext";
import { ProChatLayout } from "@/app/components/pro/ProChatLayout";
import Loading from "@/components/ui/loading";

const loadingShell = (
  <div className="pro-shell flex h-dvh min-h-0 flex-col overflow-hidden">
    <RootShellPresence kind="pro" />
    <div className="flex flex-1 items-center justify-center">
      <Loading />
    </div>
  </div>
);

export default function LabAppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ProShellProvider basePath="/lab/app">
      <AuthLoading>{loadingShell}</AuthLoading>
      <Unauthenticated>
        <div className="pro-shell flex h-dvh min-h-0 flex-col items-center justify-center gap-4 overflow-hidden px-6 text-center">
          <RootShellPresence kind="pro" />
          <div className="space-y-1.5">
            <h1 className="text-lg font-medium text-foreground">
              Sign in to RIFT Pro Lab
            </h1>
            <p className="text-sm text-muted-foreground">
              Use your RIFT account to open the Pro app shell.
            </p>
          </div>
          <a
            href="/login?redirect=%2Flab%2Fapp"
            className="rounded-lg bg-foreground px-4 py-2 text-sm text-background"
          >
            Sign in
          </a>
        </div>
      </Unauthenticated>
      <Authenticated>
        <div className="pro-shell flex h-dvh min-h-0 flex-col overflow-hidden">
          <RootShellPresence kind="pro" />
          <ProChatLayout>{children}</ProChatLayout>
        </div>
      </Authenticated>
    </ProShellProvider>
  );
}
