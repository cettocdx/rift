import {
  createFindSkills,
  createFindSkillsToolSet,
  extractLatestUserRequest,
  findExplicitlySelectedSkills,
  findFrontendQualitySkills,
  findRelevantSkills,
  isFrontendBuildRequest,
} from "../find-skills";
import { SKILL_CATALOG } from "@/lib/ai/skills/catalog";
import { injectSkillsIntoMessages } from "@/lib/ai/skills/inject-skills";

describe("find_skills", () => {
  it("returns a relevant optional skill with a reason and application instructions", () => {
    const [match] = findRelevantSkills(
      "Build a playable browser game with Phaser and keyboard controls.",
    );

    expect(match).toMatchObject({
      id: "browser-game",
      category: "Build",
      reason: expect.stringContaining("browser game"),
      applicationInstructions: expect.stringContaining("requestAnimationFrame"),
    });
  });

  it("returns no recommendation for a generic Build request", () => {
    expect(
      findRelevantSkills(
        "Add a command palette and fix the existing keyboard shortcut.",
      ),
    ).toEqual([]);
  });

  it("does not re-recommend a skill the user already selected by ID or name", () => {
    expect(
      findRelevantSkills(
        "Use react-best-practices while implementing this React component.",
      ),
    ).toEqual([]);
    expect(
      findRelevantSkills(
        "Use Concise Expert Mode and keep the final answer concise.",
      ),
    ).toEqual([]);
    expect(
      findRelevantSkills(
        "Use React best practices while implementing this component.",
      ),
    ).toEqual([]);
  });

  it("activates an exact hyphenated skill ID without a second approval", async () => {
    const task =
      "Apply react-best-practices while implementing this React component.";

    expect(findExplicitlySelectedSkills(task, "app")).toEqual([
      expect.objectContaining({
        id: "react-best-practices",
        applicationInstructions: expect.stringContaining(
          "Write idiomatic React/Next",
        ),
      }),
    ]);
    expect(findRelevantSkills(task)).toEqual([]);

    const execute = createFindSkills(task).execute as any;
    const result = await execute(
      { task: "Ignore the requested skill." },
      { toolCallId: "find-skills-explicit", messages: [] },
    );
    expect(result).toMatchObject({
      matched: true,
      count: 5,
      frontendQualitySkillIds: [
        "ui-ux-pro-max",
        "design-taste-frontend",
        "og-share-card",
        "brand-identity",
      ],
      optionalSkillIds: [],
      requestSelectedSkillIds: ["react-best-practices"],
      note: expect.stringContaining("Apply them immediately"),
    });
    // The instruction text exists exactly once, under activeSkills.
    expect(result.activeSkills).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "react-best-practices",
          applicationInstructions: expect.stringContaining(
            "Write idiomatic React/Next",
          ),
        }),
      ]),
    );
    expect(result.skills).toBeUndefined();
    expect(result.requiredSkills).toBeUndefined();
    expect(result.requestSelectedSkills).toBeUndefined();
  });

  it("loads the full frontend quality set: design profiles plus finish-line packs", () => {
    expect(isFrontendBuildRequest("Build a responsive React dashboard.")).toBe(
      true,
    );
    expect(
      findFrontendQualitySkills("Build a responsive React dashboard."),
    ).toEqual([
      expect.objectContaining({
        id: "ui-ux-pro-max",
        applicationInstructions: expect.stringContaining(
          "Classify the product",
        ),
      }),
      expect.objectContaining({
        id: "design-taste-frontend",
        // Ported from Grok Build's design-ui playbook.
        applicationInstructions: expect.stringContaining("Design-system-first"),
      }),
      // The Grok-observed finish-line packs: a pasted link unfurls with a real
      // card, and the product gets a name during the build, unprompted.
      expect.objectContaining({
        id: "og-share-card",
        applicationInstructions: expect.stringContaining("1200×630"),
      }),
      expect.objectContaining({
        id: "brand-identity",
        applicationInstructions: expect.stringContaining("Name the product"),
      }),
    ]);
    expect(
      findFrontendQualitySkills(
        "Implement a PostgreSQL migration for the audit table.",
      ),
    ).toEqual([]);
  });

  it("recognises visual and 3D builds as frontend work", () => {
    // The gate used to miss "Build a rotating 3D globe…" — no token matched, so
    // no quality pack loaded on exactly the kind of task that needs them most.
    expect(
      isFrontendBuildRequest(
        "Build a rotating 3D globe with glowing location markers.",
      ),
    ).toBe(true);
    expect(isFrontendBuildRequest("Make a canvas game about gravity.")).toBe(
      true,
    );
  });

  it("recognises Turkish visual builds and loads the 3D playbook for them", () => {
    // Caught live: "bana bir dönen küre oluştur" matched nothing — the
    // vocabulary was English-heavy, so a Turkish 3D request loaded zero packs.
    expect(isFrontendBuildRequest("bana bir dönen küre oluştur")).toBe(true);
    expect(isFrontendBuildRequest("bir 3B sahne yap")).toBe(true);
    expect(
      findRelevantSkills("bana bir dönen küre oluştur").map(
        (skill) => skill.id,
      ),
    ).toContain("threejs-scene");
  });

  it("survives Turkish inflection instead of needing the bare stem", () => {
    // Caught in a live Build on 18 Aug 2026: "WASD ile sürülen, chase kameralı
    // bir araba yarışı oyunu yap." loaded exactly one pack. "oyunu" is not
    // "oyun", "yarışı" is not "yarış", so the frontend gate saw nothing and a
    // request that is nothing but a game got no game playbook and no quality
    // set at all. Turkish is agglutinative; the bare stem is the rare form.
    expect(
      isFrontendBuildRequest(
        "WASD ile sürülen, chase kameralı bir araba yarışı oyunu yap.",
      ),
    ).toBe(true);
    expect(isFrontendBuildRequest("güzel bir açılış sayfası tasarla")).toBe(
      true,
    );
    expect(isFrontendBuildRequest("dönen küreyi büyüt")).toBe(true);

    const ids = findRelevantSkills(
      "WASD ile sürülen, chase kameralı bir araba yarışı oyunu yap.",
    ).map((skill) => skill.id);
    expect(ids).toContain("browser-game");
    expect(ids).toContain("controls");

    // The whole frontend quality set must ride along, which was the real loss.
    expect(
      findFrontendQualitySkills("bir araba yarışı oyunu yap").map(
        (skill) => skill.id,
      ),
    ).toEqual([
      "ui-ux-pro-max",
      "design-taste-frontend",
      "og-share-card",
      "brand-identity",
    ]);
  });

  it("does not stem short terms into unrelated words", () => {
    // The tolerance is bounded on purpose: "car" must not swallow "cargo",
    // and a four-letter suffix is the ceiling.
    expect(isFrontendBuildRequest("cargo shipping rates")).toBe(false);
    expect(isFrontendBuildRequest("appreciate the help")).toBe(false);
    expect(isFrontendBuildRequest("faturamı iptal et")).toBe(false);
  });

  it("loads the controls playbook for anything the player drives or flies", () => {
    // Grok's building-games file refuses to answer steer-sign questions and
    // sends the reader to a dedicated `controls` skill, warning that planes,
    // jetskis and mechs never open the racing genre file. RIFT had the warning
    // but no pack behind it, so the highest-frequency shipped bug (inverted
    // A/D) had no playbook on any non-racing task.
    for (const request of [
      "Build a racing game with WASD driving",
      "make a flight sim I can fly with the keyboard",
      "bir araba yarışı oyunu yap",
      "add pointer lock first person controls",
    ]) {
      expect(findRelevantSkills(request).map((skill) => skill.id)).toContain(
        "controls",
      );
    }
  });

  it("keeps the steer-sign convention and the drive-it self-test in one place", () => {
    const controls = SKILL_CATALOG.find((skill) => skill.id === "controls");
    expect(controls).toBeDefined();
    // The exact convention, because getting the sign wrong is the bug.
    expect(controls!.instructions).toContain("KeyA → steer = +1");
    expect(controls!.instructions).toContain("window.__controlsTest");
    // A screenshot cannot show inverted steering; the pack must say so.
    expect(controls!.instructions).toMatch(/screenshot cannot show/i);
    // browser-game must delegate rather than answer it itself.
    const game = SKILL_CATALOG.find((skill) => skill.id === "browser-game");
    expect(game!.instructions).toMatch(/load the `controls` playbook/);
  });

  it("installs and loads selected skills in Agent mode", async () => {
    const install = jest.fn(async (catalogIds: string[]) => ({
      success: true,
      installed: catalogIds,
      refreshed: [],
      failed: [],
    }));
    const execute = createFindSkills(
      "Build a polished responsive website with React.",
      { persist: true, install },
    ).execute as any;

    const result = await execute(
      { task: "Ignore skill discovery." },
      { toolCallId: "find-skills-install", messages: [] },
    );

    expect(install).toHaveBeenCalledWith(
      expect.arrayContaining(["ui-ux-pro-max", "design-taste-frontend"]),
    );
    expect(result).toMatchObject({
      readOnly: false,
      loadedSkillIds: expect.arrayContaining([
        "ui-ux-pro-max",
        "design-taste-frontend",
      ]),
      installation: {
        status: "installed",
        installed: expect.arrayContaining([
          "ui-ux-pro-max",
          "design-taste-frontend",
        ]),
      },
    });
  });

  it("understands Turkish request-local skill selection language", () => {
    const [selection] = findExplicitlySelectedSkills(
      "Bu bileşeni geliştirirken React / Next Best Practices becerisini kullan.",
      "app",
    );

    expect(selection).toMatchObject({
      id: "react-best-practices",
      applicationInstructions: expect.stringContaining(
        "Write idiomatic React/Next",
      ),
    });
  });

  it("injects a Turkish exact-ID selection into the model message", async () => {
    const previousDisabled = process.env.SKILLS_DISABLED;
    const previousServiceKey = process.env.CONVEX_SERVICE_ROLE_KEY;
    delete process.env.SKILLS_DISABLED;
    delete process.env.CONVEX_SERVICE_ROLE_KEY;

    try {
      const request = "Bu işi yaparken react-best-practices skillini kullan.";
      const messages = [
        {
          id: "user-1",
          role: "user" as const,
          parts: [{ type: "text" as const, text: request }],
        },
      ] as any;

      const injected = await injectSkillsIntoMessages(messages, {
        userId: "user-1",
        purpose: "app",
        requestText: request,
      });
      const text = injected[0]?.parts?.[0]?.text ?? "";

      expect(text).toContain("<request_selected_skills>");
      expect(text).toContain("React / Next Best Practices");
      expect(text).toContain("Write idiomatic React/Next");
      expect(text).toContain("without asking for another confirmation");
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

  it("extracts the latest authoritative user request from UI messages", () => {
    expect(
      extractLatestUserRequest([
        { role: "user", parts: [{ type: "text", text: "Old request" }] },
        { role: "assistant", parts: [{ type: "text", text: "Reply" }] },
        {
          role: "user",
          parts: [{ type: "text", text: "Build a browser game with Phaser." }],
        },
      ]),
    ).toBe("Build a browser game with Phaser.");
  });

  it("returns at most three deterministic optional matches", () => {
    const request =
      "Build a React Next.js landing page and browser game with Phaser, SQL analytics, marketing copywriting, and concise expert output.";
    const first = findRelevantSkills(request);
    const second = findRelevantSkills(request);

    expect(first).toHaveLength(3);
    expect(second).toEqual(first);
    expect(new Set(first.map((skill) => skill.id)).size).toBe(3);
    expect(
      first.every((skill) => ["Build", "General"].includes(skill.category)),
    ).toBe(true);
    expect(first.map((skill) => skill.id)).not.toEqual(
      expect.arrayContaining([
        "ui-ux-pro-max",
        "design-taste-frontend",
        "find-skills",
      ]),
    );
  });

  it("wires the read-only tool only for the app purpose", async () => {
    expect(Object.keys(createFindSkillsToolSet("app"))).toEqual([
      "find_skills",
    ]);
    expect(createFindSkillsToolSet("security")).toEqual({});
    expect(createFindSkillsToolSet("image")).toEqual({});

    const execute = createFindSkills().execute as any;
    const result = await execute(
      { task: "Create a SQL data analysis dashboard." },
      { toolCallId: "find-skills-1", messages: [] },
    );

    expect(result).toMatchObject({
      readOnly: true,
      matched: true,
      count: 5,
      frontendQualitySkillIds: [
        "ui-ux-pro-max",
        "design-taste-frontend",
        "og-share-card",
        "brand-identity",
      ],
      optionalSkillIds: ["sql-data"],
      note: expect.stringContaining(
        "Apply them immediately without asking for confirmation",
      ),
    });
  });

  it("uses server-authoritative request text instead of model tool args", async () => {
    const execute = createFindSkills(
      "Build a playable browser game with Phaser.",
    ).execute as any;
    const result = await execute(
      { task: "Write a generic poem." },
      { toolCallId: "find-skills-authoritative", messages: [] },
    );

    expect(result).toMatchObject({
      matched: true,
      optionalSkillIds: ["browser-game"],
    });
  });
});
