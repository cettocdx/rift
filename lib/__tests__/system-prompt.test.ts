import { describe, expect, it } from "@jest/globals";
import { systemPrompt } from "@/lib/system-prompt";
import { selectModel } from "@/lib/chat/chat-processor";
import { BUILD_MODELS } from "@/types/chat";

describe("systemPrompt security instructions", () => {
  it("does not claim isolated container execution for dangerous local hosts", async () => {
    const localHostContext = `You are executing commands on macOS 15.0 (arm64) in DANGEROUS MODE.
Commands are invoked via /bin/bash -c.
Commands run directly on the host OS "workstation" without Docker isolation. Be careful with:
- File system operations (no sandbox protection)
- Network operations (direct access to host network)
- Process management (can affect host system)`;

    const prompt = await systemPrompt(
      "user_123",
      "agent",
      "pro",
      "agent-model",
      null,
      false,
      localHostContext,
    );

    expect(prompt).toContain(localHostContext);
    expect(prompt).toContain("terminal commands can affect the user's host OS");
    expect(prompt).toContain("Use non-destructive verification by default.");
    expect(prompt).toContain(
      "Do not pursue credential theft, stealth, persistence, disruption or unrequested access.",
    );
    expect(prompt).toContain(
      "Do not repeatedly ask about already established authorization.",
    );
    expect(prompt).toContain(
      "Public-source research is not an active penetration test.",
    );
    expect(prompt).toContain(
      "Do not substitute a plan or a tutorial for a requested execution",
    );
    expect(prompt).not.toContain(
      "All operations execute in isolated sandbox containers",
    );
  });

  it("keeps cloud sandbox isolation scoped to the default cloud sandbox", async () => {
    const prompt = await systemPrompt(
      "user_123",
      "agent",
      "pro",
      "agent-model",
      null,
      false,
      null,
    );

    expect(prompt).toContain(
      "For the default cloud sandbox, commands run in an isolated container",
    );
    expect(prompt).toContain(
      "All tools operate in an isolated cloud sandbox environment",
    );
  });

  it("does not describe a command sandbox in ask mode", async () => {
    const prompt = await systemPrompt(
      "user_123",
      "ask",
      "pro",
      "ask-model",
      null,
      false,
      null,
    );

    expect(prompt).toContain("This chat has no terminal command environment.");
    expect(prompt).not.toContain(
      "For the default cloud sandbox, commands run in an isolated container",
    );
  });
});

describe("systemPrompt answer contract outside Build", () => {
  it("ends the turn with the outcome, not an inventory of the work", async () => {
    const prompt = await systemPrompt(
      "user_123",
      "agent",
      "pro",
      "agent-model",
      null,
      false,
      null,
    );

    expect(prompt).toContain(
      "End your turn with the OUTCOME in one sentence, naming the thing",
    );
    expect(prompt).toContain(
      "Describe the state of the world, not your activity.",
    );
    // The old spec invited a high-level recap of changes; that is what produced
    // "I've made the changes you requested" endings.
    expect(prompt).not.toContain(
      "Summarize any changes you made at a high-level and their impact",
    );
  });

  it("narrates at decision points and never announces a tool", async () => {
    const prompt = await systemPrompt(
      "user_123",
      "agent",
      "pro",
      "agent-model",
      null,
      false,
      null,
    );

    expect(prompt).toContain("<narration>");
    expect(prompt).toContain(
      "Between tool calls, write only at DECISION POINTS",
    );
    expect(prompt).toContain("Describe commands by intent, not by their text.");
  });
});

describe("systemPrompt Build completion gate", () => {
  it("requires verify_app before exposing a generated app", async () => {
    const prompt = await systemPrompt(
      "user_123",
      "agent",
      "pro",
      "agent-model",
      null,
      false,
      null,
      "app",
    );

    expect(prompt).toContain(
      "call `verify_app` with the absolute project directory AND its live port",
    );
    expect(prompt).toContain(
      "Only after it returns `ok: true` AND the frames look right may you call `expose_preview`",
    );
    expect(prompt).toContain(
      "web-preview completion gate; validates the production build and live HTTP response",
    );
  });

  it("makes the agent look at the screenshots, not just the check results", async () => {
    // verify_app returns desktop and mobile frames. Passing structural checks
    // cannot see clipping, contrast, or crowding, so the gate is explicitly
    // "ok AND it looks right" — see
    // docs/product-transformation/grok-agent-behaviour-2026-08-17.md.
    const prompt = await systemPrompt(
      "user_123",
      "agent",
      "pro",
      "agent-model",
      null,
      false,
      null,
      "app",
    );

    expect(prompt).toContain("VERIFY → LOOK → REPAIR → PREVIEW");
    expect(prompt).toContain(
      "`ok: true` means the page rendered, not that it looks right",
    );
    expect(prompt).toContain(
      "name the specific defect, fix it, and rerun `verify_app` to confirm the fix landed",
    );
  });

  it("holds Build to the observed answer contract", async () => {
    const prompt = await systemPrompt(
      "user_123",
      "agent",
      "pro",
      "agent-model",
      null,
      false,
      null,
      "app",
    );

    // Outcome first, named artifact, sections earned rather than templated.
    expect(prompt).toContain("<answer_contract>");
    expect(prompt).toContain(
      "<Name> is live in the preview — <one clause saying what it is>.",
    );
    expect(prompt).toContain("Sections are EARNED, not templated");
    expect(prompt).toContain("Describe what they can DO, not what you did.");
    // The thing gets a name and real content, decided while building.
    expect(prompt).toContain("<naming>");
    expect(prompt).toContain('"Apsis", not "the simulation"');
    expect(prompt).toContain("Write real content, never placeholder copy");
  });

  it("narrates at decision points rather than announcing tools", async () => {
    const prompt = await systemPrompt(
      "user_123",
      "agent",
      "pro",
      "agent-model",
      null,
      false,
      null,
      "app",
    );

    expect(prompt).toContain(
      "Write between tool calls only at DECISION POINTS",
    );
    expect(prompt).toContain(
      "The tool is invisible; the reason is the content",
    );
    expect(prompt).toContain(
      "state it as the symptom the reader would see and continue in the same sentence",
    );
  });

  it("teaches the main agent to delegate bounded parallel specialist work", async () => {
    const prompt = await systemPrompt(
      "user_123",
      "agent",
      "pro",
      "agent-model",
      null,
      false,
      null,
      "app",
    );

    expect(prompt).toContain(
      "use `delegate_task` with an exact server-listed agentId",
    );
    expect(prompt).toContain("launch independent specialists in the same");
    expect(prompt).toContain(
      "Bounded subagents can inspect permitted files and read-only research tools",
    );
  });

  it("does not advertise subagents in Build plan mode where the tool is absent", async () => {
    const prompt = await systemPrompt(
      "user_123",
      "ask",
      "pro",
      "agent-model",
      null,
      false,
      null,
      "app",
    );

    expect(prompt).not.toContain("delegate_task");
  });
});

describe("systemPrompt Build skill policy", () => {
  it.each(
    BUILD_MODELS.flatMap((entry) =>
      (["agent", "ask"] as const).map(
        (mode) => [entry.id, entry.model, mode] as const,
      ),
    ),
  )(
    "carries no unrequested skill payload for %s / %s in %s mode",
    async (selection, _modelLabel, mode) => {
      const resolvedModel = selectModel(mode, "pro", selection, false, "app");
      const prompt = await systemPrompt(
        "user_123",
        mode,
        "pro",
        resolvedModel,
        null,
        false,
        null,
        "app",
      );

      expect(prompt).toContain("<skills>");
      expect(prompt).toContain(
        "Before applicable implementation or planning, load the relevant playbooks",
      );
      // The packs still never ride in the prompt itself — they arrive at
      // runtime through the agent's own find_skills call, so the prompt stays
      // cache-stable and a non-frontend request pays nothing.
      expect(prompt).not.toContain("<frontend_quality_contract>");
      expect(prompt).not.toContain("Meet WCAG AA contrast");
      expect(prompt).not.toContain("375, 768, 1024, and 1440 pixels");
      expect(prompt).toContain("<progress_presentation>");
      if (mode === "agent") {
        expect(prompt).toContain("publish an observable execution plan");
        expect(prompt).toContain("Keep exactly one item in progress");
      } else {
        expect(prompt).not.toContain("use todo_write");
      }
    },
  );

  it.each(["agent", "ask"] as const)(
    "loads applicable Build playbooks without forcing a call for explanations in %s mode",
    async (mode) => {
      const prompt = await systemPrompt(
        "user_123",
        mode,
        "pro",
        "agent-model",
        null,
        false,
        null,
        "app",
      );

      expect(prompt).toContain(
        "Before applicable implementation or planning, load the relevant playbooks",
      );
      expect(prompt).toContain("exact `skill_ids` from the enabled manifest");
      expect(prompt).toContain("Answer self-contained explanations directly");
      expect(prompt).toContain("not loaded");
      expect(prompt).toContain("without asking");
      expect(prompt).not.toContain(
        "never call `find_skills` on your own initiative",
      );
    },
  );

  it("keeps Build plan mode explicitly non-executing", async () => {
    const prompt = await systemPrompt(
      "user_123",
      "ask",
      "pro",
      "agent-model",
      null,
      false,
      null,
      "app",
    );

    expect(prompt).toContain("strictly read-only planning surface");
    expect(prompt).toContain(
      "Do not create, update, or delete files, notes, media, tasks, messages, remote records, or any other state",
    );
    expect(prompt).toContain("call mutating integrations");
    expect(prompt).toContain("execution happens only in Agent mode");
  });
});

describe("model-independent Build workflow", () => {
  it.each(BUILD_MODELS.map((model) => model.id))(
    "keeps generic repository tasks and evidence-based verification for %s",
    async (selection) => {
      const model = selectModel("agent", "pro", selection, false, "app");
      const prompt = await systemPrompt(
        "user_123",
        "agent",
        "pro",
        model,
        null,
        false,
        null,
        "app",
      );
      expect(prompt).toContain(
        "Read the existing project instructions, relevant files, and test configuration before editing",
      );
      expect(prompt).toContain(
        "For repository inspection, backend, library, CLI, documentation, or configuration work",
      );
      expect(prompt).toContain(
        "Do not create a web app, start a server, or call verify_app/expose_preview unless the task calls for a web preview",
      );
      expect(prompt).toContain(
        "Report the relevant checks you actually ran and their results",
      );
      expect(prompt).not.toContain(
        "Once execution begins, the runtime keeps the tool loop active until this verified preview succeeds",
      );
      expect(prompt).not.toContain(
        "Never list what you implemented, what files you touched",
      );
    },
  );

  it("keeps local Plan environment metadata without cloud assumptions or execution permission", async () => {
    const context =
      'Selected execution target: local runner "Work Mac". OS metadata: {"platform":"darwin","arch":"arm64"}.';
    const prompt = await systemPrompt(
      "user_123",
      "ask",
      "pro",
      "agent-model",
      null,
      false,
      context,
      "app",
    );
    expect(prompt).toContain(context);
    expect(prompt).toContain("selected execution target");
    expect(prompt).not.toContain("current cloud workspace");
    expect(prompt).toContain("Do not run commands");
    expect(prompt).toContain("strictly read-only");
  });

  it("does not tell a local Build Agent it is operating in an isolated Linux cloud sandbox", async () => {
    const prompt = await systemPrompt(
      "user_123",
      "agent",
      "pro",
      "agent-model",
      null,
      false,
      "Selected target: macOS local runner",
      "app",
    );
    expect(prompt).toContain("Selected target: macOS local runner");
    expect(prompt).not.toContain(
      "You operate inside an isolated cloud sandbox",
    );
  });

  it("grounds Plan in the same project's files without advertising execution", async () => {
    const prompt = await systemPrompt(
      "user_123",
      "ask",
      "pro",
      "agent-model",
      null,
      false,
      null,
      "app",
    );
    expect(prompt).toContain("list_files");
    expect(prompt).toContain("read action");
    expect(prompt).not.toContain("use todo_write");
    expect(prompt).toContain("Do not run commands");
  });
});

describe("standalone Build greeting prompt", () => {
  it("omits the tool manual but preserves identity, language, and temporary-chat context", async () => {
    const prompt = await systemPrompt(
      "u",
      "agent",
      "pro",
      "agent-model",
      null,
      true,
      null,
      "app",
      { standaloneGreeting: true },
    );
    expect(prompt.length).toBeLessThan(1000);
    expect(prompt).toContain("RIFT");
    expect(prompt).toContain("SAME language");
    expect(prompt).toContain("temporary");
    expect(prompt).toContain("Do not claim");
    expect(prompt).not.toContain("<workflow>");
  });
  it("keeps the complete Build workflow on normal turns", async () => {
    const prompt = await systemPrompt(
      "u",
      "agent",
      "pro",
      "agent-model",
      null,
      false,
      null,
      "app",
    );
    expect(prompt).toContain("<workflow>");
    expect(prompt).toContain("VERIFY");
  });
  it("does not replace security mode instructions", async () => {
    const prompt = await systemPrompt(
      "u",
      "agent",
      "pro",
      "agent-model",
      null,
      false,
      null,
      "security",
      { standaloneGreeting: true },
    );
    expect(prompt).toContain("cybersecurity professionals");
  });
});

describe("explicit tool-free Build text prompt", () => {
  it("keeps text instructions and privacy while dropping the execution manual", async () => {
    const args = [
      "u",
      "agent",
      "pro",
      "agent-model",
      null,
      true,
      null,
      "app",
    ] as const;
    const full = await systemPrompt(...args);
    const text = await systemPrompt(...args, { standaloneText: true });
    expect(text).toContain("explicitly requested no tools");
    expect(text).toContain("Preserve the requested detail and format");
    expect(text).toContain("temporary");
    expect(text).not.toContain("No work has been requested");
    expect(text).not.toContain("verify_app");
    expect(text.length).toBeLessThan(full.length / 4);
  });
});
