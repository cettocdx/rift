import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import type { Id } from "../_generated/dataModel";

jest.mock("../_generated/server", () => ({
  mutation: jest.fn((config: any) => config),
  internalMutation: jest.fn((config: any) => config),
  query: jest.fn((config: any) => config),
  internalQuery: jest.fn((config: any) => config),
}));
jest.mock("../lib/utils", () => ({ validateServiceKey: jest.fn() }));
jest.mock("../../lib/utils/file-utils", () => ({
  isSupportedImageMediaType: jest.fn(),
}));
jest.mock("../_generated/api", () => ({ internal: { fileStorage: {} } }));
const aggregate = {
  insertIfDoesNotExist: jest.fn<any>().mockResolvedValue(undefined),
  sum: jest.fn<any>().mockResolvedValue(0),
  count: jest.fn<any>().mockResolvedValue(0),
};
jest.mock("../fileAggregate", () => ({ fileCountAggregate: aggregate }));

function makeCtx() {
  const inserted: Record<string, unknown>[] = [];
  return {
    inserted,
    ctx: {
      db: {
        query: () => ({
          withIndex: () => ({ collect: async () => [] }),
        }),
        insert: jest.fn<any>(async (_table: string, doc: Record<string, unknown>) => {
          inserted.push(doc);
          return "new-file" as Id<"files">;
        }),
        get: jest.fn<any>(async () => inserted[0] ?? null),
      },
    } as any,
  };
}

describe("saveFileToDb persists generation lineage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  it("stores what a generated asset was made from", async () => {
    const { saveFileToDb } = await import("../fileStorage");
    const { inserted, ctx } = makeCtx();

    await saveFileToDb.handler(ctx, {
      storageId: "kg1" as Id<"_storage">,
      userId: "user-1",
      name: "rift-image.png",
      mediaType: "image/png",
      size: 1024,
      fileTokenSize: 0,
      trustedServiceGenerated: true,
      generation: {
        prompt: "a red bicycle at dusk",
        model: "google/gemini-3.1-flash-image",
        surface: "studio",
        settings: { aspectRatio: "16:9" },
        costDollars: 0.02,
        runId: "run-abc",
      },
    } as never);

    expect(inserted).toHaveLength(1);
    expect(inserted[0].generation).toMatchObject({
      prompt: "a red bicycle at dusk",
      model: "google/gemini-3.1-flash-image",
      surface: "studio",
      cost_dollars: 0.02,
      run_id: "run-abc",
    });
    // Recorded when it was stored, so the asset carries its own timestamp.
    expect(typeof (inserted[0].generation as { created_at: number }).created_at).toBe(
      "number",
    );
  });

  it("leaves an uploaded file with no generation block", async () => {
    // A file a person uploaded was not generated and has no lineage to invent.
    const { saveFileToDb } = await import("../fileStorage");
    const { inserted, ctx } = makeCtx();

    await saveFileToDb.handler(ctx, {
      storageId: "kg2" as Id<"_storage">,
      userId: "user-1",
      name: "notes.pdf",
      mediaType: "application/pdf",
      size: 2048,
      fileTokenSize: 10,
    } as never);

    expect(inserted[0].generation).toBeUndefined();
  });
});

// Real Convex validators: a saved generated file must also be readable.
describe("generated file return contracts", () => {
  it("accepts generation metadata in both lookup return schemas", async () => {
    const { getFileById, getFileByS3Key } = await import("../fileStorage");
    for (const lookup of [getFileById, getFileByS3Key]) {
      const json = (lookup as any).returns.json;
      const document = json.value.find((variant: any) => variant.type === "object");
      expect(document.value.generation.optional).toBe(true);
      expect(document.value.generation.fieldType.value).toMatchObject({
        prompt: { fieldType: { type: "string" } },
        model: { fieldType: { type: "string" } },
        created_at: { fieldType: { type: "number" } },
      });
    }
  });
});
