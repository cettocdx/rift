"use client";

import { useGlobalState } from "@/app/contexts/GlobalState";

/** Headline for the empty chat, tailored to the current mode (purpose). */
const GREETINGS: Record<string, string> = {
  security: "How can I help you today?",
  app: "What should we build?",
  image: "What image should I create?",
};

/** Minimal empty-chat headline — operation presets live in the sidebar menu. */
export const HackingSuggestions = () => {
  const { chatPurpose } = useGlobalState();
  const headline = GREETINGS[chatPurpose] ?? GREETINGS.security;
  return (
    <div data-rift-empty-hero className="text-center">
      <h1 className="mb-1.5 text-[22px] font-normal tracking-tight text-foreground">
        {headline}
      </h1>
    </div>
  );
};
