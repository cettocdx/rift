import {
  hasNonObjectRoot,
  normalizeMcpRootSchema,
} from "../mcp-tool-schema";

describe("MCP tool root schema normalization", () => {
  it("leaves a well-formed object root untouched", () => {
    const schema = {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    };

    expect(normalizeMcpRootSchema(schema)).toBe(schema);
    expect(hasNonObjectRoot(schema)).toBe(false);
  });

  it("flattens the union root that took whole xAI runs down", () => {
    // Reproduces Higgsfield's video_analysis_create: xAI rejected the tool with
    // "root schema is an anyOf/oneOf union with a non-object branch", and the
    // failure killed the entire conversation, not just that tool.
    const schema = {
      anyOf: [
        {
          type: "object",
          properties: { video_url: { type: "string" }, prompt: { type: "string" } },
          required: ["video_url", "prompt"],
        },
        {
          type: "object",
          properties: { video_id: { type: "string" }, prompt: { type: "string" } },
          required: ["video_id", "prompt"],
        },
        { type: "string" },
      ],
    };

    expect(hasNonObjectRoot(schema)).toBe(true);
    const normalized = normalizeMcpRootSchema(schema);

    expect(normalized.type).toBe("object");
    expect(normalized).not.toHaveProperty("anyOf");
    expect(Object.keys(normalized.properties as object).sort()).toEqual([
      "prompt",
      "video_id",
      "video_url",
    ]);
    // Only what EVERY alternative demanded survives: either id form is valid,
    // so requiring both would make half the legitimate calls impossible.
    expect(normalized.required).toEqual(["prompt"]);
    expect(hasNonObjectRoot(normalized)).toBe(false);
  });

  it("keeps every allOf requirement, since all branches apply at once", () => {
    const normalized = normalizeMcpRootSchema({
      allOf: [
        { type: "object", properties: { a: { type: "string" } }, required: ["a"] },
        { type: "object", properties: { b: { type: "number" } }, required: ["b"] },
      ],
    });

    expect(normalized.type).toBe("object");
    expect((normalized.required as string[]).sort()).toEqual(["a", "b"]);
  });

  it("degrades a scalar root to a permissive object instead of dropping the tool", () => {
    expect(normalizeMcpRootSchema({ type: "string" })).toEqual({
      type: "object",
      properties: {},
      additionalProperties: true,
    });
  });

  it("treats a typeless root as the object every MCP tool means", () => {
    expect(
      normalizeMcpRootSchema({ properties: { path: { type: "string" } } }),
    ).toMatchObject({
      type: "object",
      properties: { path: { type: "string" } },
    });
  });

  it("never emits a required key that has no matching property", () => {
    const normalized = normalizeMcpRootSchema({
      required: ["ghost"],
      anyOf: [{ type: "object", properties: { real: { type: "string" } } }],
    });

    expect(normalized.required).toBeUndefined();
  });

  it("survives a missing or malformed schema", () => {
    for (const input of [undefined, null, "nonsense", 42, []]) {
      expect(normalizeMcpRootSchema(input)).toEqual({
        type: "object",
        properties: {},
      });
    }
  });
});
