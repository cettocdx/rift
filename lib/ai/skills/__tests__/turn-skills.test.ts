import { SKILL_CATALOG, type SkillCatalogDefinition } from "../catalog";
import { MANAGED_AGENT_ROSTER_SKILL_ID } from "@/lib/ai/agents/pet-roster";
import {
  partitionEnabledSkillsForTurn,
  selectEnabledSkillsForTurn,
} from "../turn-skills";
import type { EnabledSkill } from "../inject-skills";

const preset = SKILL_CATALOG.find((entry) => entry.id === "controls")!;
const controls: EnabledSkill = {
  name: preset.name,
  instructions: preset.instructions,
  scope: preset.scope,
  catalog_id: preset.id,
};
const general: EnabledSkill = {
  name: "Writing preference",
  instructions: "Reply concisely in Turkish.",
  scope: "all",
};
const custom: EnabledSkill = {
  name: "Custom instructions",
  instructions: "My specific workspace convention.",
  scope: "app",
  catalog_id: "my-private-skill",
};
const customizedPreset: EnabledSkill = {
  ...controls,
  instructions: controls.instructions + "\nMy custom instruction.",
};
const roster: EnabledSkill = {
  name: "Managed bot roster",
  instructions: "Project bot definitions",
  scope: "app",
  catalog_id: MANAGED_AGENT_ROSTER_SKILL_ID,
};
const skills = [controls, general, custom, customizedPreset, roster];

it("omits unchanged task presets and the managed roster only for a classified fresh greeting", () => {
  expect(
    selectEnabledSkillsForTurn(skills, {
      purpose: "app",
      standaloneGreeting: true,
    }),
  ).toEqual([general, custom, customizedPreset]);
});

it.each([undefined, false])(
  "retains enabled skills for real work or unclassified input (%s)",
  (standaloneGreeting) => {
    expect(
      selectEnabledSkillsForTurn(skills, {
        purpose: "app",
        standaloneGreeting,
      }),
    ).toBe(skills);
  },
);

it.each(["security", "image"] as const)(
  "never applies the Build greeting policy to %s",
  (purpose) => {
    expect(
      selectEnabledSkillsForTurn(skills, { purpose, standaloneGreeting: true }),
    ).toBe(skills);
  },
);

it("retains a preset explicitly scoped for every conversation", () => {
  const global = { ...controls, scope: "all" as const };
  expect(
    selectEnabledSkillsForTurn([global], {
      purpose: "app",
      standaloneGreeting: true,
    }),
  ).toEqual([global]);
});

const enabledPreset = (id: string): EnabledSkill => {
  const entry = SKILL_CATALOG.find((skill) => skill.id === id)!;
  return {
    name: entry.name,
    instructions: entry.instructions,
    scope: entry.scope,
    catalog_id: entry.id,
  };
};

describe("progressive enabled-skill partition", () => {
  it("exposes a compact manifest for an unchanged reviewed Build preset", () => {
    const result = partitionEnabledSkillsForTurn(
      [controls, general, custom, roster],
      { purpose: "app" },
    );
    expect(result.eager).toEqual([general, custom, roster]);
    expect(result.deferred).toEqual([
      { id: preset.id, name: controls.name, description: preset.description },
    ]);
    expect(result.deferred[0]).not.toHaveProperty("instructions");
    expect(result.eager[0]).toBe(general);
  });

  it("retains explicitly selected presets in full without also advertising them", () => {
    const result = partitionEnabledSkillsForTurn([controls], {
      purpose: "app",
      explicitSkillIds: new Set([preset.id]),
    });
    expect(result).toEqual({ eager: [controls], deferred: [] });
    expect(result.eager[0]).toBe(controls);
  });

  it("keeps customized, global, unknown and managed authorization guidance eager", () => {
    const global = { ...controls, scope: "all" as const };
    const noCatalog = { ...custom, catalog_id: undefined };
    const protectedSkills = [
      customizedPreset,
      global,
      custom,
      noCatalog,
      roster,
    ];
    expect(
      partitionEnabledSkillsForTurn(protectedSkills, { purpose: "app" }),
    ).toEqual({ eager: protectedSkills, deferred: [] });
  });

  it.each(["security", "image"] as const)(
    "does not partition skills for the %s surface",
    (purpose) => {
      expect(partitionEnabledSkillsForTurn(skills, { purpose })).toEqual({
        eager: skills,
        deferred: [],
      });
    },
  );

  it("does not defer a catalog scope mismatch or an ambiguous duplicated catalog ID", () => {
    const security = enabledPreset("pentest-report");
    const mismatch = { ...security, scope: "app" as const };
    const source = [controls, customizedPreset, mismatch];
    expect(partitionEnabledSkillsForTurn(source, { purpose: "app" })).toEqual({
      eager: source,
      deferred: [],
    });
  });

  it("preserves order, skill identities and input data without request classification", () => {
    const frontend = enabledPreset("design-taste-frontend");
    const source = Object.freeze([controls, general, frontend]);
    Object.freeze(controls);
    const result = partitionEnabledSkillsForTurn(source, { purpose: "app" });
    expect(result.eager).toEqual([general]);
    expect(result.deferred.map((skill) => skill.id)).toEqual([
      "controls",
      "design-taste-frontend",
    ]);
    expect(source).toEqual([controls, general, frontend]);
  });

  it("retains a preset whose broad automatic trigger is absent from its description", () => {
    const shareCard = enabledPreset("og-share-card");
    expect(
      partitionEnabledSkillsForTurn([shareCard], { purpose: "app" }),
    ).toEqual({ eager: [shareCard], deferred: [] });
  });

  it("retains a reviewed preset if its manifest description becomes blank", () => {
    const mutablePreset = preset as SkillCatalogDefinition;
    const original = mutablePreset.description;
    try {
      mutablePreset.description = "   ";
      expect(
        partitionEnabledSkillsForTurn([controls], { purpose: "app" }),
      ).toEqual({ eager: [controls], deferred: [] });
    } finally {
      mutablePreset.description = original;
    }
  });

  it("keeps a future catalog entry eager until its description has been reviewed", () => {
    const future = {
      ...preset,
      id: "future-build-preset",
      name: "Future preset",
      description: "A new specialized capability.",
    };
    const mutableCatalog = SKILL_CATALOG as unknown as SkillCatalogDefinition[];
    mutableCatalog.push(future);
    try {
      const enabled = enabledPreset(future.id);
      expect(
        partitionEnabledSkillsForTurn([enabled], { purpose: "app" }),
      ).toEqual({ eager: [enabled], deferred: [] });
    } finally {
      mutableCatalog.pop();
    }
  });
});
