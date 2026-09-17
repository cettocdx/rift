import { z } from "zod";

import { createGenerateVideo } from "../generate-video";
import { createGenerateImage } from "../generate-image";

/**
 * Caught live in Media Studio on 18 Aug 2026. The model sent a complete,
 * shot-ready `generate_video` call — prompt, aspectRatio, duration,
 * generateAudio — and the run died with:
 *
 *   Invalid input: expected string, received undefined  (path: ["brief"])
 *
 * `brief` is a caption for the rendering placeholder. `execute` never reads it,
 * and the client already normalises a missing one to undefined. Requiring it
 * meant one absent word threw away the whole generation.
 */
const schemaOf = (tool: unknown) =>
  (tool as { inputSchema: z.ZodType }).inputSchema;

describe("media generation tools accept a missing brief", () => {
  const context = {} as Parameters<typeof createGenerateVideo>[0];

  it("keeps a real video call valid without a brief", () => {
    const parsed = schemaOf(createGenerateVideo(context)).safeParse({
      prompt:
        "A pair of matte-black over-ear headphones rotates slowly on an invisible turntable against a deep charcoal backdrop.",
      aspectRatio: "16:9",
      duration: 8,
      generateAudio: true,
    });
    expect(parsed.success).toBe(true);
  });

  it("keeps a real image call valid without a brief", () => {
    const parsed = schemaOf(createGenerateImage(context)).safeParse({
      prompt:
        "A brushed aluminium desk lamp on a concrete surface, single hard key light, deep shadow, editorial product photography.",
      aspectRatio: "1:1",
    });
    expect(parsed.success).toBe(true);
  });

  it("still accepts and bounds a brief when the model supplies one", () => {
    const parsed = schemaOf(createGenerateVideo(context)).safeParse({
      prompt: "A slow push-in on a rain-streaked window at dusk.",
      brief: "Rain window push-in",
    });
    expect(parsed.success).toBe(true);
    expect(
      schemaOf(createGenerateVideo(context)).safeParse({
        prompt: "A slow push-in on a rain-streaked window at dusk.",
        brief: "x".repeat(241),
      }).success,
    ).toBe(false);
  });

  it("still rejects a call with no prompt at all", () => {
    expect(
      schemaOf(createGenerateVideo(context)).safeParse({ brief: "something" })
        .success,
    ).toBe(false);
  });
});
