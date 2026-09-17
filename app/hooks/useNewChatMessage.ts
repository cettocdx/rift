import { useEffect, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { takeNewChatMessage } from "@/lib/utils/new-chat-message";

export function useNewChatMessage({
  ready,
  onSubmit,
}: {
  ready: boolean;
  onSubmit: (
    event: FormEvent,
    submission: { input: string; mode: "agent"; isolated: true },
  ) => void | Promise<void>;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const intentId = searchParams.get("agentTest");

  useEffect(() => {
    if (!ready || !intentId) return;
    const text = takeNewChatMessage(intentId);
    if (!text) return;

    const remainingParams = new URLSearchParams(searchParams.toString());
    remainingParams.delete("agentTest");
    const query = remainingParams.toString();
    router.replace(query ? `/?${query}` : "/", { scroll: false });
    void onSubmit(new Event("submit") as unknown as FormEvent, {
      input: text,
      mode: "agent",
      isolated: true,
    });
  }, [intentId, onSubmit, ready, router, searchParams]);
}
