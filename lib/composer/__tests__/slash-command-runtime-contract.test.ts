import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { WEB_SLASH_COMMANDS } from "../palette-items";

const runtimeSource = readFileSync(
  resolve(process.cwd(), "app/components/ChatInput/useSlashCommandRuntime.ts"),
  "utf8",
);
const normalChatSurfaceSource = [
  "app/components/ChatLayout.tsx",
  "app/components/pro/ProChatLayout.tsx",
  "app/components/workbench/CursorIdeLayout.tsx",
  "app/components/chat.tsx",
]
  .map((path) => readFileSync(resolve(process.cwd(), path), "utf8"))
  .join("\n");

function runtimeCaseIds(): Set<string> {
  return new Set(
    Array.from(
      runtimeSource.matchAll(/\bcase "([a-z0-9-]+)":/g),
      (match) => match[1],
    ),
  );
}

describe("slash-command web runtime contract", () => {
  it("has an explicit handler for every command advertised on web", () => {
    const handled = runtimeCaseIds();
    const missing = WEB_SLASH_COMMANDS.filter(
      (command) => !handled.has(command.id),
    ).map((command) => command.id);

    expect(missing).toEqual([]);
  });

  it("opens the real composer model selector for bare /model", () => {
    expect(runtimeSource).toMatch(
      /case "model": \{[\s\S]*?if \(!args\) \{[\s\S]*?openModelSelector\(\)/,
    );
  });

  it("does not mount legacy pentest launchers on normal chat surfaces", () => {
    expect(normalChatSurfaceSource).not.toContain(
      "OperationLauncherController",
    );
    expect(normalChatSurfaceSource).not.toContain("OperationModeBar");
  });

  it("checks active-host and purpose availability before validation or dispatch", () => {
    expect(runtimeSource).toContain("const { isTauri } = useTauri()");
    expect(runtimeSource).toContain(
      'const activeSurface = isTauri ? "desktop" : "web"',
    );
    const availabilityBoundary = runtimeSource.indexOf(
      "if (!command.availability[activeSurface])",
    );
    const purposeBoundary = runtimeSource.indexOf(
      "if (!command.purposes.includes(chatPurpose))",
    );
    const argumentValidation = runtimeSource.indexOf(
      "if (!parsed.validation.valid)",
    );
    const dispatch = runtimeSource.indexOf("switch (command.id)");

    expect(availabilityBoundary).toBeGreaterThan(-1);
    expect(availabilityBoundary).toBeLessThan(argumentValidation);
    expect(availabilityBoundary).toBeLessThan(dispatch);
    expect(purposeBoundary).toBeGreaterThan(availabilityBoundary);
    expect(purposeBoundary).toBeLessThan(argumentValidation);
    expect(purposeBoundary).toBeLessThan(dispatch);
  });

  it("does not misroute key native-only commands through web handlers", () => {
    const handled = runtimeCaseIds();
    for (const id of [
      "approve",
      "archive",
      "compact",
      "feedback",
      "ide-context",
      "import",
      "pet",
      "raw",
      "side",
      "statusline",
      "title",
      "vim",
      "worktree",
    ]) {
      expect(handled.has(id)).toBe(false);
    }
  });

  it("routes /skills to the skills workbench tab", () => {
    expect(runtimeSource).toMatch(
      /case "skills":\s+clear\(\);\s+router\.push\("\/plugins\?tab=skills"\);/,
    );
  });
});
