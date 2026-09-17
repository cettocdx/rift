import { ChatRouteShell, type ChatShellVariant } from "./ChatRouteShell";

/**
 * Shared layout for / and /c/[id]. Renders the Chat Sidebar only when authenticated
 * so it stays mounted across navigations within the group. AuthLoading and
 * Unauthenticated get a full-width shell (no sidebar).
 */
export default function ChatRouteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const variant: ChatShellVariant =
    process.env.RIFT_UI_SKIN === "standard" ? "standard" : "pro";

  return <ChatRouteShell variant={variant}>{children}</ChatRouteShell>;
}
