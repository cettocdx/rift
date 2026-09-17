"use client";

import { Authenticated, AuthLoading, Unauthenticated } from "convex/react";
import dynamic from "next/dynamic";
import { ChatViewport } from "@/app/components/chat-layout/ChatViewport";
import { ChatLayout } from "@/app/components/ChatLayout";
import { ProShellProvider } from "@/app/components/pro/ProShellContext";
import { ChatViewStateProvider } from "@/app/contexts/ChatViewStateContext";
import { useDesktopLastChat } from "@/app/hooks/useDesktopLastChat";
import { useAuth } from "@/app/hooks/useAuth";
import {
  AppLaunchComplete,
  AppLaunchFallback,
} from "@/components/launch/AppLaunchProvider";

export type ChatShellVariant = "standard" | "pro";

const fullWidthShell = (
  <ChatViewport>
    <div className="flex min-h-0 flex-1 items-center justify-center">
      <AppLaunchFallback />
    </div>
  </ChatViewport>
);

// Keep the Pro command-palette/workbench surface in its own chunk so the
// unauthenticated shell and the explicit standard fallback stay lightweight.
const ProChatLayout = dynamic(
  () =>
    import("@/app/components/pro/ProChatLayout").then(
      (module) => module.ProChatLayout,
    ),
  { loading: AppLaunchFallback },
);

function StandardChatShell({ children }: { children: React.ReactNode }) {
  return <ChatLayout>{children}</ChatLayout>;
}

function ProChatShell({ children }: { children: React.ReactNode }) {
  return (
    <ProShellProvider basePath="/">
      <ProChatLayout>{children}</ProChatLayout>
    </ProShellProvider>
  );
}

function AuthenticatedChatSessions({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user } = useAuth();
  useDesktopLastChat(user?.id);
  const scope = user?.id ?? "loading";
  return <ChatViewStateProvider key={scope}>{children}</ChatViewStateProvider>;
}

/**
 * Client auth boundary shared by the default Pro app and its explicit standard
 * fallback. The file IDE lives at /workspace instead of replacing chat pages.
 */
export function ChatRouteShell({
  children,
  variant,
}: {
  children: React.ReactNode;
  variant: ChatShellVariant;
}) {
  const isProShell = variant === "pro";

  return (
    <>
      <AuthLoading>{fullWidthShell}</AuthLoading>
      <Unauthenticated>
        <AppLaunchComplete />
        <ChatViewport>{children}</ChatViewport>
      </Unauthenticated>
      <Authenticated>
        <AuthenticatedChatSessions>
          <ChatViewport
            data-rift-route-shell="chat"
            data-workbench-variant={isProShell ? "cursor" : "standard"}
          >
            {isProShell ? (
              <ProChatShell>{children}</ProChatShell>
            ) : (
              <StandardChatShell>{children}</StandardChatShell>
            )}
          </ChatViewport>
        </AuthenticatedChatSessions>
      </Authenticated>
    </>
  );
}
