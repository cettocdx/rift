import type { ChatPurpose } from "@/types/chat";

/** The conversation id in a route, or null for a non-chat / new-chat route. */
export function chatIdFromPathname(pathname: string): string | null {
  const match = pathname.match(/(?:^|\/)c\/([^/]+)(?:\/|$)/);
  return match?.[1] || null;
}

/** Canonical first-party route for a conversation purpose. */
export function purposeChatPath(purpose: ChatPurpose, chatId?: string | null) {
  const basePath = purpose === "image" ? "/studio" : "";
  if (!chatId) return basePath || "/";
  return `${basePath}/c/${chatId}`;
}

/** Route-aware workspace selection for top-level and deep-link navigation. */
export function isPurposeChatActive(
  purpose: Extract<ChatPurpose, "app" | "image">,
  pathname: string,
  currentPurpose: ChatPurpose,
) {
  if (purpose === "image") {
    return (
      pathname === "/studio" ||
      pathname.startsWith("/studio/c/") ||
      (pathname === "/" && currentPurpose === "image")
    );
  }

  return (
    (pathname === "/" || pathname.startsWith("/c/")) &&
    currentPurpose !== "image"
  );
}
