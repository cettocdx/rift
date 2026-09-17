import { buildSkillsReminder, type EnabledSkill } from "@/lib/ai/skills/inject-skills";

/**
 * Pure rendering of the per-run OpenCode "workspace": the Build agent prompt,
 * AGENTS.md (the user's enabled skills, exactly as the legacy loop injected
 * them), and the config fragment that registers the `rift-build` agent.
 *
 * The prompt is the legacy Build system prompt (single source of truth —
 * agent-long already computed it for this run) with the tool vocabulary
 * adapted to OpenCode's built-ins: `file` → read/edit/write (GPT models get
 * `apply_patch`), `run_terminal_cmd` + `is_background` → `bash` with `nohup
 * … &`, `todo_write` → `todowrite`, `delegate_task` → `task`, and step 0's
 * `find_skills` becomes "your playbooks are already loaded" because the
 * materializer inlines them. MCP is not rendered here yet (follow-up).
 */

export interface WorkspaceInput {
  /** Legacy Build system prompt for this run (streamCtx.currentSystemPrompt). */
  buildSystemPrompt: string;
  enabledSkills: EnabledSkill[];
  maxSteps: number;
  homeDir?: string;
}

export interface RenderedWorkspace {
  files: Array<{ path: string; content: string }>;
  configExtensions: Record<string, unknown>;
  agentName: "rift-build";
}

const REPLACEMENTS: Array<[RegExp, string]> = [
  // step 0: playbooks are inlined into AGENTS.md by the materializer
  [
    /0\. PLAYBOOKS: call `find_skills`[^\n]*\n/,
    "0. PLAYBOOKS: your playbooks are already loaded (see AGENTS.md and the <active_skills> block). Apply them in full. If the `skill` tool lists a playbook for a domain you enter (3D, game loop, landing page, brand), call it by name.\n",
  ],
  [/`find_skills`/g, "the `skill` tool"],
  [/`todo_write`/g, "`todowrite`"],
  [/todo_write to publish/g, "todowrite to publish"],
  [/`delegate_task`/g, "`task`"],
  [
    /4\. RUN: start the dev server in the BACKGROUND \(`run_terminal_cmd` with `is_background: true`, e\.g\. `npm run dev -- --host 0\.0\.0\.0 --port 5173`\)\./,
    "4. RUN: start the dev server in the BACKGROUND with `bash`: `nohup npm run dev -- --host 0.0.0.0 --port 5173 > /tmp/dev.log 2>&1 &` then `sleep 2 && tail -n 40 /tmp/dev.log`. Never run a dev server in the foreground (bash calls time out).",
  ],
  [/Read its background output for the real error/g, "Read `/tmp/dev.log` for the real error"],
  [
    /- `file`: read\/write\/edit project files\.\n- `run_terminal_cmd`: run shell commands; use `is_background: true` for the dev server and other long-running processes\./,
    "- `read` / `edit` / `write` (or `apply_patch`): read and change project files. `glob` and `grep` find files and code — use them instead of `find`/`cat`/`grep` in bash.\n- `bash`: run shell commands; long-running processes (dev servers) must be started with `nohup … > /tmp/dev.log 2>&1 &`.",
  ],
  [/run_terminal_cmd/g, "bash"],
  [/is_background: true/g, "nohup … &"],
];

export function adaptBuildPromptForOpenCode(prompt: string): string {
  let out = prompt;
  for (const [re, to] of REPLACEMENTS) out = out.replace(re, to);
  return out;
}

export function renderOpenCodeWorkspace(input: WorkspaceInput): RenderedWorkspace {
  const homeDir = input.homeDir ?? "/home/user";
  const base = `${homeDir}/.config/opencode`;
  const promptPath = `${base}/prompts/rift-build.md`;
  const skills = buildSkillsReminder(input.enabledSkills, "app");
  const agentsMd = [
    "# RIFT Build",
    "",
    "You are running inside RIFT's Build sandbox. `verify_app` and `expose_preview` are RIFT tools served by the host; call them exactly as described in your instructions.",
    "",
    skills,
  ]
    .filter(Boolean)
    .join("\n");
  return {
    agentName: "rift-build",
    files: [
      { path: promptPath, content: adaptBuildPromptForOpenCode(input.buildSystemPrompt) },
      { path: `${base}/AGENTS.md`, content: agentsMd },
    ],
    configExtensions: {
      agent: {
        "rift-build": {
          mode: "primary",
          prompt: `{file:${promptPath}}`,
          steps: input.maxSteps,
          permission: { "*": "allow", webfetch: "allow", websearch: "deny", question: "deny" },
        },
      },
    },
  };
}
