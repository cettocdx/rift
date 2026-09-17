/** @jest-environment node */
import { countTokens } from "gpt-tokenizer";
import { createTools } from "../index";
import type { ChatPurpose } from "@/types/chat";

jest.mock("../utils/sandbox-manager", () => ({
  DefaultSandboxManager: jest.fn(() => ({ getSandbox: jest.fn() })),
}));
jest.mock("../utils/hybrid-sandbox-manager", () => ({
  HybridSandboxManager: jest.fn(() => ({ getSandbox: jest.fn() })),
}));

function toolsFor(purpose: ChatPurpose = "app") {
  const args: Parameters<typeof createTools> = [
    "context-test-owner",
    "context-test-chat",
    { write: jest.fn() } as never,
    "agent",
    {} as never,
  ];
  args[26] = purpose;
  return createTools(...args).tools;
}

const compactToolNames = [
  "run_terminal_cmd",
  "interact_terminal_session",
  "file",
  "create_note",
  "list_notes",
  "update_note",
  "delete_note",
];

it("keeps routine Build tool instructions within a bounded context budget", () => {
  const tools = toolsFor();
  const tokens = compactToolNames.reduce((sum, name) => {
    expect(tools[name]).toBeDefined();
    expect(tools[name].execute).toEqual(expect.any(Function));
    return sum + countTokens(tools[name].description ?? "");
  }, 0);
  // These seven descriptions previously consumed over 3,000 tokens on every
  // request, even when the user only wanted a short explanation.
  expect(tokens).toBeLessThan(2000);
});

it("does not tell Build to bypass approvals or start security scans", () => {
  const description = toolsFor().run_terminal_cmd.description!;
  expect(description).not.toMatch(/without requiring user approval/i);
  expect(description).toMatch(/approval/i);
  expect(description).not.toMatch(/sqlmap|nmap|pentest|wordlists|nuclei/i);
});

it("retains execution and evidence guidance rather than only shortening text", () => {
  const tools = toolsFor();
  expect(tools.run_terminal_cmd.description).toMatch(/non.interactive/i);
  expect(tools.run_terminal_cmd.description).toMatch(/optional.*independent/i);
  expect(tools.run_terminal_cmd.description).toMatch(/get_terminal_files/);
  expect(tools.run_terminal_cmd.description).toMatch(
    /file.*execut|save.*execut/i,
  );
  const session = tools.interact_terminal_session.description!;
  expect(session).toMatch(
    /timeout.*(?:not|never).*kill|(?:not|never).*kill.*timeout/i,
  );
  expect(session).toMatch(/verbatim/);
  expect(session).toMatch(/scrollback.path/);
  expect(session).toMatch(/bufferTruncated/);
  expect(session).toMatch(/guardrail/i);
  expect(tools.create_note.description).toMatch(/across.*conversations/i);
  expect(tools.create_note.description).toMatch(/(?:not|never).*authoriz/i);
  expect(tools.delete_note.description).toMatch(/(?:permanent|irreversible)/i);
});

it("keeps scoped assessment guidance available in Hack Workbench", () => {
  const description = toolsFor("security").run_terminal_cmd.description!;
  expect(description).toMatch(/target|scope/i);
  expect(description).toMatch(/scan|assessment/i);
  expect(description).toMatch(/timeout/i);
});
