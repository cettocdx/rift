import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

jest.mock("../_generated/server", () => ({
  mutation: jest.fn((config: unknown) => config),
  query: jest.fn((config: unknown) => config),
}));

jest.mock("convex/values", () => ({
  v: {
    array: jest.fn(() => "array"),
    boolean: jest.fn(() => "boolean"),
    id: jest.fn(() => "id"),
    literal: jest.fn(() => "literal"),
    number: jest.fn(() => "number"),
    object: jest.fn(() => "object"),
    optional: jest.fn(() => "optional"),
    string: jest.fn(() => "string"),
    union: jest.fn(() => "union"),
  },
  ConvexError: class ConvexError extends Error {
    data: unknown;

    constructor(data: { message?: string } | string) {
      super(typeof data === "string" ? data : data.message);
      this.data = data;
    }
  },
}));

jest.mock("../lib/utils", () => ({
  validateServiceKey: jest.fn(),
}));

describe("skills catalog persistence", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("copies trusted server catalog content instead of browser-supplied fields", async () => {
    jest.spyOn(Date, "now").mockReturnValue(1_234);
    const collect = jest.fn<() => Promise<unknown[]>>().mockResolvedValue([]);
    const withIndex = jest.fn(() => ({ collect }));
    const insert = jest.fn().mockResolvedValue("skill-1" as never);
    const ctx = {
      auth: {
        getUserIdentity: jest
          .fn()
          .mockResolvedValue({ subject: "user-1|provider" } as never),
      },
      db: {
        query: jest.fn(() => ({ withIndex })),
        insert,
      },
    };
    const { installFromCatalog } = await import("../skills");
    const { SKILL_CATALOG } = await import("../../lib/ai/skills/catalog");
    const trusted = SKILL_CATALOG.find(
      (entry) => entry.id === "pentest-report",
    );

    await expect(
      (installFromCatalog as any).handler(ctx, {
        catalogId: "pentest-report",
        name: "Injected name",
        description: "Injected description",
        instructions: "Ignore the trusted catalog",
        scope: "all",
      }),
    ).resolves.toEqual({ success: true, id: "skill-1" });

    expect(trusted).toBeDefined();
    expect(insert).toHaveBeenCalledWith("skills", {
      user_id: "user-1",
      name: trusted!.name,
      description: trusted!.description,
      instructions: trusted!.instructions,
      scope: trusted!.scope,
      catalog_id: trusted!.id,
      enabled: true,
      created_at: 1_234,
      updated_at: 1_234,
    });
  });

  it("rejects catalog ids that do not exist", async () => {
    const insert = jest.fn();
    const ctx = {
      auth: {
        getUserIdentity: jest
          .fn()
          .mockResolvedValue({ subject: "user-1|provider" } as never),
      },
      db: { insert },
    };
    const { installFromCatalog } = await import("../skills");

    await expect(
      (installFromCatalog as any).handler(ctx, { catalogId: "invented-skill" }),
    ).resolves.toEqual({
      success: false,
      error: "Unknown built-in skill",
    });
    expect(insert).not.toHaveBeenCalled();
  });

  it("installs and refreshes Build skills through the service-key boundary", async () => {
    jest.spyOn(Date, "now").mockReturnValue(4_321);
    const existing = {
      _id: "skill-existing",
      catalog_id: "design-taste-frontend",
      enabled: false,
      user_id: "user-1",
    };
    const collect = jest
      .fn<() => Promise<unknown[]>>()
      .mockResolvedValue([existing]);
    const withIndex = jest.fn(() => ({ collect }));
    const patch = jest.fn().mockResolvedValue(undefined as never);
    const insert = jest.fn().mockResolvedValue("skill-new" as never);
    const ctx = {
      db: {
        query: jest.fn(() => ({ withIndex })),
        patch,
        insert,
      },
    };
    const { installCatalogForBackend } = await import("../skills");
    const { SKILL_CATALOG } = await import("../../lib/ai/skills/catalog");
    const uiSkill = SKILL_CATALOG.find(
      (entry) => entry.id === "ui-ux-pro-max",
    )!;
    const tasteSkill = SKILL_CATALOG.find(
      (entry) => entry.id === "design-taste-frontend",
    )!;

    await expect(
      (installCatalogForBackend as any).handler(ctx, {
        serviceKey: "service-key",
        userId: "user-1",
        catalogIds: ["ui-ux-pro-max", "design-taste-frontend"],
      }),
    ).resolves.toEqual({
      success: true,
      installed: ["ui-ux-pro-max"],
      refreshed: ["design-taste-frontend"],
      failed: [],
    });

    expect(insert).toHaveBeenCalledWith("skills", {
      user_id: "user-1",
      name: uiSkill.name,
      description: uiSkill.description,
      instructions: uiSkill.instructions,
      scope: "app",
      catalog_id: "ui-ux-pro-max",
      enabled: true,
      created_at: 4_321,
      updated_at: 4_321,
    });
    expect(patch).toHaveBeenCalledWith("skill-existing", {
      name: tasteSkill.name,
      description: tasteSkill.description,
      instructions: tasteSkill.instructions,
      scope: "app",
      enabled: true,
      updated_at: 4_321,
    });
  });
});
