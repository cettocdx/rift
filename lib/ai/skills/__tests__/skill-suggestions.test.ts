import {
  buildSkillSuggestionReminder,
  findSuggestibleSkills,
} from "../skill-suggestions";
import { injectSkillsIntoMessages } from "../inject-skills";
import { SKILL_CATALOG } from "../catalog";

const frontendRequest = "Build a responsive React dashboard page";

describe("skill suggestions", () => {
  it("offers the frontend quality packs by name only, never their instructions", () => {
    const suggestions = findSuggestibleSkills(frontendRequest);
    expect(suggestions.map((skill) => skill.id)).toEqual(
      expect.arrayContaining(["ui-ux-pro-max", "design-taste-frontend"]),
    );

    const reminder = buildSkillSuggestionReminder(suggestions);
    expect(reminder).toContain("<skill_suggestions>");
    expect(reminder).toContain("ui-ux-pro-max");
    // The pack body is what used to cost ~1k tokens on every request.
    expect(reminder).not.toContain("Meet WCAG AA contrast");
    expect(reminder).not.toContain("Classify the product");
  });

  it("stays far cheaper than the instruction packs it replaces", () => {
    const reminder = buildSkillSuggestionReminder(
      findSuggestibleSkills(frontendRequest),
    );
    const packs = SKILL_CATALOG.filter((skill) =>
      ["ui-ux-pro-max", "design-taste-frontend"].includes(skill.id),
    )
      .map((skill) => skill.instructions)
      .join("\n");

    expect(reminder.length).toBeLessThan(packs.length / 4);
  });

  it("suggests nothing when no catalog skill matches the request", () => {
    expect(findSuggestibleSkills("Fix the failing unit test in utils.ts")).toEqual(
      [],
    );
    expect(buildSkillSuggestionReminder([])).toBe("");
  });

  it("does not re-suggest a skill that is already active", () => {
    const suggestions = findSuggestibleSkills(frontendRequest, {
      excludeIds: new Set(["ui-ux-pro-max"]),
    });
    expect(suggestions.map((skill) => skill.id)).not.toContain("ui-ux-pro-max");
    expect(suggestions.map((skill) => skill.id)).toContain(
      "design-taste-frontend",
    );
  });

  it("injects suggestions for Build only, and never activates them", async () => {
    const previousDisabled = process.env.SKILLS_DISABLED;
    const previousServiceKey = process.env.CONVEX_SERVICE_ROLE_KEY;
    delete process.env.SKILLS_DISABLED;
    delete process.env.CONVEX_SERVICE_ROLE_KEY;

    const messages = () =>
      [
        {
          id: "user-1",
          role: "user" as const,
          parts: [{ type: "text" as const, text: frontendRequest }],
        },
      ] as never;

    try {
      const build = await injectSkillsIntoMessages(messages(), {
        userId: "user-1",
        purpose: "app",
        requestText: frontendRequest,
      });
      const buildText =
        (build[0] as { parts?: Array<{ text?: string }> })?.parts?.[0]?.text ??
        "";
      expect(buildText).toContain("<skill_suggestions>");
      expect(buildText).toContain("Their instructions are NOT loaded yet");
      expect(buildText).not.toContain("Meet WCAG AA contrast");

      const security = await injectSkillsIntoMessages(messages(), {
        userId: "user-1",
        purpose: "security",
        requestText: frontendRequest,
      });
      const securityText =
        (security[0] as { parts?: Array<{ text?: string }> })?.parts?.[0]
          ?.text ?? "";
      expect(securityText).not.toContain("<skill_suggestions>");
    } finally {
      if (previousDisabled === undefined) delete process.env.SKILLS_DISABLED;
      else process.env.SKILLS_DISABLED = previousDisabled;
      if (previousServiceKey === undefined) {
        delete process.env.CONVEX_SERVICE_ROLE_KEY;
      } else {
        process.env.CONVEX_SERVICE_ROLE_KEY = previousServiceKey;
      }
    }
  });
});
