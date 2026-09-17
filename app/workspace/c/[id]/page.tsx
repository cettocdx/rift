"use client";

import { use } from "react";
import { Chat } from "@/app/components/chat";
import { useHydrated } from "@/app/hooks/useHydrated";

export default function WorkspaceChatPage(props: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(props.params);
  const hydrated = useHydrated();
  if (!hydrated) return null;

  return <Chat key={id} autoResume />;
}
