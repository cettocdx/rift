"use client";

import { useGlobalState } from "@/app/contexts/GlobalState";

const GREETINGS: Record<string, string> = {
  security: "What can I help you build?",
  app: "What can I help you build?",
  image: "What would you like to create?",
};

export function ProEmptyHero() {
  const { chatPurpose, activeProject } = useGlobalState();

  if (chatPurpose === "image") {
    return (
      <div data-rift-empty-hero className="pro-empty-hero">
        <p className="mb-2 text-[12px] font-medium text-muted-foreground">
          RIFT Studio
        </p>
        <h1 className="rift-welcome-title">Bring your next idea to life.</h1>
        <p className="mt-2 text-[13px] text-muted-foreground">
          Create images and films, from first thought to final frame.
        </p>
      </div>
    );
  }

  if (chatPurpose === "app") {
    return (
      <div data-rift-empty-hero className="pro-empty-hero">
        <h1 className="rift-welcome-title">
          {activeProject?.name
            ? `Let’s build something in ${activeProject.name}`
            : "What would you like to build?"}
        </h1>
      </div>
    );
  }

  return (
    <div data-rift-empty-hero className="pro-empty-hero px-4 text-center">
      <h1 className="font-sans text-[22px] font-medium leading-7 tracking-[-0.02em] text-foreground md:text-[24px]">
        {GREETINGS[chatPurpose] ?? GREETINGS.security}
      </h1>
    </div>
  );
}
