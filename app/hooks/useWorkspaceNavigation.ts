"use client";

import { useCallback, useEffect } from "react";
import { usePathname } from "next/navigation";
import { useChatNavigation } from "./useChatNavigation";
import {
  isPurposeChatActive,
  chatIdFromPathname,
} from "@/lib/navigation/chat-routes";
import { useGlobalState } from "@/app/contexts/GlobalState";

import { getUserIdFromDrafts } from "@/lib/utils/client-storage";

type WorkspacePurpose = "app" | "image";
const key = (purpose: WorkspacePurpose) =>
  `rift:last-workspace:${getUserIdFromDrafts() ?? "anonymous"}:${purpose}`;

/** Opening a workspace preserves its last conversation; New chat is explicit. */
export function useWorkspaceNavigation() {
  const pathname = usePathname();
  const { chatPurpose } = useGlobalState();
  const { goPurpose } = useChatNavigation();
  useEffect(() => {
    for (const purpose of ["app", "image"] as const) {
      if (!isPurposeChatActive(purpose, pathname, chatPurpose)) continue;
      try {
        sessionStorage.setItem(
          key(purpose),
          chatIdFromPathname(pathname) ?? "",
        );
      } catch {}
    }
  }, [pathname, chatPurpose]);

  return useCallback(
    (purpose: WorkspacePurpose) => {
      if (isPurposeChatActive(purpose, pathname, chatPurpose)) return;
      let id: string | null = null;
      try {
        id = sessionStorage.getItem(key(purpose));
      } catch {}
      if (id) goPurpose(purpose, id);
      else goPurpose(purpose);
    },
    [chatPurpose, pathname, goPurpose],
  );
}
