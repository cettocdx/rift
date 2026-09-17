import { renderHook } from "@testing-library/react";
import { DataStreamProvider } from "@/app/components/DataStreamProvider";
import { useAutoResume } from "../useAutoResume";
import type { ChatMessage } from "@/types/chat";

it.each(["submitted", "streaming"] as const)(
  "does not replay a locally %s answer when the server announces its run",
  (status) => {
    const resumeStream = jest.fn().mockResolvedValue(undefined);
    const params = {
      autoResume: true,
      initialMessages: [
        {
          id: "user",
          role: "user",
          parts: [{ type: "text", text: "merhaba" }],
        },
      ] as ChatMessage[],
      resumeStream,
      setMessages: jest.fn(),
      status,
      hasActiveStream: true,
    };
    const { rerender } = renderHook(
      ({ currentStatus }) =>
        useAutoResume({ ...params, status: currentStatus }),
      {
        initialProps: {
          currentStatus: status as "submitted" | "streaming" | "ready",
        },
        wrapper: DataStreamProvider,
      },
    );
    expect(resumeStream).not.toHaveBeenCalled();
    // A late server status update must not replay the completed local answer.
    rerender({ currentStatus: "ready" });
    expect(resumeStream).not.toHaveBeenCalled();
  },
);
