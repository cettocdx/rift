import { RootShellPresence } from "@/app/components/RootShellPresence";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ProShellProvider } from "@/app/components/pro/ProShellContext";
import { CursorIdeLayout } from "@/app/components/workbench/CursorIdeLayout";
import { getUserIDAndPro } from "@/lib/auth/get-user-id";
import { hasPremiumAccess } from "@/lib/auth/premium-access";
import { ChatSDKError } from "@/lib/errors";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Agent Workspace | RIFT",
  description: "RIFT's premium file, agent, and terminal workspace.",
  robots: { index: false, follow: false },
};

/**
 * Premium-gated IDE surface. Authorization lives on the server here and is
 * repeated by every Workbench API route; client state is never the authority
 * for access to sandbox files. The route must not depend on a presentation
 * skin environment variable: CLI Workspace is a product surface, not a dev
 * preview, and must remain discoverable on every app server.
 */
export default async function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let access: Awaited<ReturnType<typeof getUserIDAndPro>>;
  try {
    access = await getUserIDAndPro();
  } catch (error) {
    if (error instanceof ChatSDKError && error.type === "unauthorized") {
      redirect("/login?redirect=%2Fworkspace");
    }
    throw error;
  }

  if (!hasPremiumAccess(access.subscription)) {
    redirect("/upgrade?feature=workspace");
  }

  return (
    <ProShellProvider basePath="/workspace">
      <div
        data-rift-route-shell="chat"
        data-rift-workspace-shell
        data-workbench-variant="cursor"
        className="flex h-[100dvh] min-h-[100dvh] min-w-0 flex-col overflow-hidden bg-background"
      >
        <RootShellPresence kind="chat" />
        <CursorIdeLayout>{children}</CursorIdeLayout>
      </div>
    </ProShellProvider>
  );
}
