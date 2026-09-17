import { adaptBuildPromptForOpenCode, renderOpenCodeWorkspace } from "@/lib/opencode/workspace";

const legacy = [
  "0. PLAYBOOKS: call `find_skills` with the user's request before anything else, and apply every pack it returns.",
  "1. REQUIREMENTS: use `delegate_task` for research. Use `todo_write` to keep the checklist explicit.",
  "4. RUN: start the dev server in the BACKGROUND (`run_terminal_cmd` with `is_background: true`, e.g. `npm run dev -- --host 0.0.0.0 --port 5173`).",
  "- `file`: read/write/edit project files.",
  "- `run_terminal_cmd`: run shell commands; use `is_background: true` for the dev server and other long-running processes.",
  "- `verify_app`: mandatory gate.",
].join("\n");

describe("adaptBuildPromptForOpenCode", () => {
  it("rewrites the legacy tool vocabulary to OpenCode's", () => {
    const out = adaptBuildPromptForOpenCode(legacy);
    expect(out).not.toContain("find_skills");
    expect(out).toContain("playbooks are already loaded");
    expect(out).toContain("`todowrite`");
    expect(out).toContain("`task`");
    expect(out).not.toContain("run_terminal_cmd");
    expect(out).not.toContain("is_background: true");
    expect(out).toContain("nohup npm run dev");
    expect(out).toContain("`glob` and `grep`");
    expect(out).toContain("`verify_app`"); // bridged RIFT tool keeps its name
  });
});

describe("renderOpenCodeWorkspace", () => {
  it("emits the prompt file, AGENTS.md with enabled skills, and the rift-build agent config", () => {
    const ws = renderOpenCodeWorkspace({
      buildSystemPrompt: legacy,
      enabledSkills: [{ name: "Brand kit", instructions: "Use the brand palette.", scope: "app" }],
      maxSteps: 120,
    });
    expect(ws.agentName).toBe("rift-build");
    expect(ws.files.map((f) => f.path)).toEqual([
      "/home/user/.config/opencode/prompts/rift-build.md",
      "/home/user/.config/opencode/AGENTS.md",
    ]);
    expect(ws.files[1].content).toContain("<active_skills>");
    expect(ws.files[1].content).toContain("## Skill: Brand kit");
    expect(ws.configExtensions).toEqual({
      agent: {
        "rift-build": {
          mode: "primary",
          prompt: "{file:/home/user/.config/opencode/prompts/rift-build.md}",
          steps: 120,
          permission: { "*": "allow", webfetch: "allow", websearch: "deny", question: "deny" },
        },
      },
    });
  });
  it("omits the skills block when none apply", () => {
    const ws = renderOpenCodeWorkspace({ buildSystemPrompt: legacy, enabledSkills: [], maxSteps: 1 });
    expect(ws.files[1].content).not.toContain("<active_skills>");
  });
});
