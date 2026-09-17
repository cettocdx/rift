import fs from "node:fs";
import path from "node:path";

/**
 * Section 24.5: every generated output retains its prompt, model, settings,
 * cost and source run. A generated asset was an anonymous file before this;
 * these lock the lineage onto the persistence path so it cannot quietly drop.
 */
describe("generated media carries its lineage", () => {
  const read = (rel: string) =>
    fs.readFileSync(path.join(process.cwd(), rel), "utf8");

  it("generate_image records prompt, model, cost and run", () => {
    const src = read("lib/ai/tools/generate-image.ts");
    const call = src.slice(src.search(/persistGeneratedMediaBytes\(\s*\{/));
    expect(call).toContain("generation: {");
    expect(call).toContain("prompt: input.prompt");
    expect(call).toContain("model: policy.model");
    expect(call).toContain("costDollars: billedCost");
    expect(call).toContain("runId: context.runRecorder?.runId");
  });

  it("generate_video records prompt, model, cost and run", () => {
    const src = read("lib/ai/tools/generate-video.ts");
    const call = src.slice(src.search(/persistGeneratedMediaBytes\(\s*\{/));
    expect(call).toContain("generation: {");
    expect(call).toContain("prompt: input.prompt");
    expect(call).toContain("model: policy.model");
    expect(call).toContain("costDollars: billedCost");
    expect(call).toContain("runId: context.runRecorder?.runId");
  });

  it("the persistence path forwards lineage all the way to the row", () => {
    // A break anywhere in this chain drops the lineage silently.
    expect(read("lib/ai/tools/utils/generated-media-storage.ts")).toContain(
      "generation: args.generation",
    );
    expect(read("convex/fileActions.ts")).toContain(
      "generation: args.generation",
    );
    expect(read("convex/fileStorage.ts")).toContain(
      "run_id: args.generation.runId",
    );
  });
});
