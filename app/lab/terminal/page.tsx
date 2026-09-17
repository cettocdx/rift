"use client";

import { useState } from "react";
import { RiftConsoleView } from "@/app/components/terminal/RiftConsoleView";
import type { ConsoleSnapshot } from "@/packages/console/src/protocol";

const sample: ConsoleSnapshot = {
  chatId: null,
  status: "ready",
  entries: [],
  model: "preview",
  modelLabel: "Preview model",
  effort: "high",
  approval: "ask",
  mode: "build",
  target: "local",
  targetLabel: "~/Developer/rift",
  models: [{ value: "preview", label: "Preview model" }],
  efforts: [{ value: "high", label: "High" }],
  permissions: [{ value: "ask", label: "Review first" }],
  modes: [{ value: "build", label: "Build" }],
  targets: [{ value: "local", label: "This Mac" }],
  approvals: [],
  queued: 0,
};
/** Isolated presentation preview; no connection, task, or model request. */
export default function TerminalPreview() {
  const [snapshot, setSnapshot] = useState(sample);
  return (
    <main style={{ height: "100dvh", background: "var(--background)" }}>
      <RiftConsoleView
        snapshot={snapshot}
        onCommand={async (command) => {
          if (command.type === "new-chat") setSnapshot(sample);
          if (command.type === "submit")
            setSnapshot({
              ...sample,
              chatId: "preview",
              entries: [
                { id: "user", kind: "user", text: command.text },
                {
                  id: "answer",
                  kind: "assistant",
                  text: "Local presentation preview. No task was sent.",
                },
              ],
            });
          return { accepted: true };
        }}
      />
    </main>
  );
}
