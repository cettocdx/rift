"use client";

import { RootShellPresence } from "@/app/components/RootShellPresence";

import { useTheme } from "next-themes";
import { ToolApprovalCard } from "@/app/components/ToolApprovalRequests";
import type { Id } from "@/convex/_generated/dataModel";
const request = {
  _id: "approval-preview" as Id<"tool_approvals">,
  toolName: "delegate_task",
  toolCallId: "approval-preview-delegate",
  expiresAt: 0,
  preview: JSON.stringify(
    {
      agentId: "quality",
      task: "Derive an observable QA checklist for a self-contained Web Audio synth and 16-step drum sequencer. Focus on controls, audio-start policy, timing, keyboard behavior, mobile responsiveness, and accessibility. Finish with concise test cases suitable for Playwright plus manual audio checks.",
      context:
        "Target file will be /home/user/form-sequencer/index.html. Required features: synthesized kick/snare/hi-hat, 3 tracks × 16 steps, play/pause, BPM slider, preset patterns, clear, mutes, visual playhead.",
    },
    null,
    2,
  ),
};
export default function ApprovalPreview() {
  const { setTheme } = useTheme();
  return (
    <main className="pro-shell min-h-dvh bg-background p-6 text-foreground">
      <RootShellPresence kind="pro" />
      <div className="mx-auto max-w-[720px]">
        <nav className="mb-12 flex gap-4 text-xs">
          <button onClick={() => setTheme("light")}>Light</button>
          <button onClick={() => setTheme("dark")}>Dark</button>
          <span>Approval preview · no actions run</span>
        </nav>
        <ToolApprovalCard request={request} onRespond={() => {}} />
      </div>
    </main>
  );
}
