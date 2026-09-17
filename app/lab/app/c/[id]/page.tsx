"use client";

import { use } from "react";
import { Chat } from "@/app/components/chat";

export default function LabChatPage(props: { params: Promise<{ id: string }> }) {
  const { id } = use(props.params);
  return <Chat key={id} autoResume />;
}
