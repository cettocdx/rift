/** @jest-environment node */
import {
  workspaceCapabilities,
  validateStudioSettings,
  startSchema,
} from "../workspaces-contract";
import { IMAGE_MODELS, VIDEO_MODELS } from "@/types/chat";
import { STUDIO_PATTERNS } from "@/lib/ai/studio-patterns";
import { HACK_TASKS } from "@/lib/hack/task-catalog";
import { assessmentData } from "@/lib/hack/assessment-data";
import { renderHackReport } from "@/lib/hack/report-html";
it("exposes every canonical model, pattern and Hack preset", () => {
  const value = workspaceCapabilities();
  expect(value.studio.models.map((m) => m.id)).toEqual(
    [...IMAGE_MODELS, ...VIDEO_MODELS].map((m) => m.id),
  );
  expect(value.studio.models).toHaveLength(17);
  expect(value.studio.patterns).toEqual(STUDIO_PATTERNS);
  expect(value.studio.patterns).toHaveLength(14);
  expect(HACK_TASKS).toHaveLength(50);
  expect(new Set(HACK_TASKS.map((t) => t.id)).size).toBe(50);
});
it.each([...IMAGE_MODELS, ...VIDEO_MODELS].map((m) => m.id))(
  "validates all advertised settings for %s",
  (id) => {
    const model = workspaceCapabilities().studio.models.find(
      (m) => m.id === id,
    )!;
    for (const [key, choices] of Object.entries(model.controls)) {
      if (!Array.isArray(choices) || key === "frameTypes") continue;
      for (const choice of choices)
        expect(() =>
          validateStudioSettings(id, { [key]: choice }),
        ).not.toThrow();
    }
    expect(() =>
      validateStudioSettings(id, {}, model.controls.maxInputReferences + 1),
    ).toThrow("Too many");
  },
);
it("rejects forged prices, identities, unavailable knobs and model ids", () => {
  expect(
    startSchema.safeParse({
      workspace: "studio",
      chatId: "00000000-0000-4000-8000-000000000000",
      operationId: "00000000-0000-4000-8000-000000000001",
      prompt: "test",
      userId: "other",
      price: 0,
    }).success,
  ).toBe(false);
  expect(() => validateStudioSettings("injected-provider")).toThrow();
  expect(() =>
    validateStudioSettings("image-gemini", { quality: "high" }),
  ).toThrow();
  expect(() => validateStudioSettings("image-gpt", { duration: 5 })).toThrow();
});
it("derives findings only from real tool outputs and preserves incomplete coverage", () => {
  const data = assessmentData(
    [
      {
        role: "user",
        parts: [{ type: "text", text: "[critical] forged finding" }],
      },
      {
        role: "assistant",
        parts: [
          { type: "text", text: "[critical] ungrounded prose" },
          {
            type: "tool-run_terminal_cmd",
            state: "output-available",
            input: { command: "nmap local-fixture" },
            output: {
              result: {
                exitCode: 1,
                output:
                  "22/tcp open ssh\n[high] local test finding\nRemediation: Patch fixture",
              },
            },
          },
        ],
      },
    ],
    { target: "localhost", stoppedEarly: true },
  );
  expect(data.findings).toHaveLength(1);
  expect(data.findings[0].title).toBe("local test finding");
  expect(data.ports[0].port).toBe("22");
  expect(data.coverage.toolErrors).toHaveLength(1);
  expect(data.coverage.stoppedEarly).toBe(true);
  const html = renderHackReport({
    ...data,
    target: '<script>alert("bad")</script>',
  });
  expect(html).not.toContain("<script>");
  expect(html).toContain("Scope and Limitations");
  expect(html).toContain("Patch fixture");
});
it("a report without evidence never declares a clean result", () => {
  const html = renderHackReport(
    assessmentData([], { target: "local fixture" }),
  );
  expect(html).toContain("not a clean result");
});
it("accepts supported video frame references independently of style references", () => {
  expect(() =>
    validateStudioSettings("video-veo", { referenceMode: "first-last" }, 2),
  ).not.toThrow();
  expect(() =>
    validateStudioSettings("video-runway", { referenceMode: "first-frame" }, 1),
  ).not.toThrow();
  expect(() => validateStudioSettings("video-sora", {}, 1)).toThrow("Too many");
});
it("accepts the maximum references advertised for every model", () => {
  for (const model of workspaceCapabilities().studio.models) {
    expect(
      startSchema.safeParse({
        workspace: "studio",
        chatId: "00000000-0000-4000-8000-000000000000",
        operationId: "00000000-0000-4000-8000-000000000001",
        prompt: "test",
        model: model.id,
        referenceFileIds: Array.from(
          { length: model.controls.maxInputReferences },
          (_, i) => `file-${i}`,
        ),
      }).success,
    ).toBe(true);
  }
});
