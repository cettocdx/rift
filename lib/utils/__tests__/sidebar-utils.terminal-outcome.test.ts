import { extractSidebarContentFromMessage } from "../sidebar-utils";
import { getActionText } from "@/app/components/computer-sidebar-utils";
import { getActivityStatus } from "@/app/components/activity-utils";

describe("terminal outcomes in Activity", () => {
  it.each([
    [
      "tool-run_terminal_cmd",
      { result: { output: "missing dependency", exitCode: 127 } },
    ],
    ["tool-shell", { output: "test failed", exitCode: 1 }],
  ])("preserves a failed %s command in the activity row", (type, output) => {
    const [entry] = extractSidebarContentFromMessage({
      role: "assistant",
      parts: [
        {
          type,
          toolCallId: "command",
          state: "output-available",
          input: { command: "check" },
          output,
        },
      ],
    });
    expect(getActionText(entry)).toBe("Failed");
    expect(getActivityStatus(entry, false)).toBe("error");
  });

  it.each([
    [
      { result: { output: "failed is ordinary stdout", exitCode: 0 } },
      "Executed",
    ],
    [{ result: { output: "partial", exitCode: 130 } }, "Interrupted"],
    [
      {
        result: {
          output: "partial",
          outcome: "unknown",
          error: "Connection lost",
          exitCode: null,
        },
      },
      "Result unconfirmed",
    ],
  ])(
    "distinguishes successful, interrupted and uncertain results",
    (output, label) => {
      const [entry] = extractSidebarContentFromMessage({
        role: "assistant",
        parts: [
          {
            type: "tool-run_terminal_cmd",
            toolCallId: "command",
            state: "output-available",
            input: { command: "check" },
            output,
          },
        ],
      });
      expect(getActionText(entry)).toBe(label);
    },
  );

  it("shows an explicit denied tool without claiming execution", () => {
    const [entry] = extractSidebarContentFromMessage({
      role: "assistant",
      parts: [
        {
          type: "tool-run_terminal_cmd",
          toolCallId: "command",
          state: "output-denied",
          input: { command: "check" },
        },
      ],
    });
    expect(getActionText(entry)).toBe("Not approved");
  });
});
