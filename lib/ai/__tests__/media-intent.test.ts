import { resolveMediaIntent, resolveMediaRequest } from "../media-intent";

describe("Media Studio intent", () => {
  it.each([
    "Create a cinematic product video with a slow camera move",
    "Bu fotografi videoya cevir ve kamerayi yavasca yaklastir",
    "Bu gorseli canlandir, 6 saniyelik bir klip yap",
    "Animate this logo into a short social reel",
    "Create a video based on this image",
    "Turn this video thumbnail into an animation",
  ])("routes explicit video language to video generation: %s", (prompt) => {
    expect(resolveMediaIntent(prompt, "image")).toMatchObject({
      kind: "video",
      confidence: expect.stringMatching(/explicit|strong/),
    });
  });

  it.each([
    "Create a product photo on a clean background",
    "Bir poster ve sosyal medya gorseli hazirla",
    "Make a YouTube video thumbnail",
    "Create a cover image for this reel",
    "Turn this video into a still image",
    "Extract a frame from this product video",
    "Bu videodan bir kare cikar",
    "Convert this photo into a video thumbnail",
  ])("keeps image deliverables on image generation: %s", (prompt) => {
    expect(resolveMediaIntent(prompt, "video").kind).toBe("image");
  });

  it("honors negation rather than matching a forbidden modality word", () => {
    expect(
      resolveMediaIntent("Do not make a video. Create a still image", "video"),
    ).toMatchObject({ kind: "image" });
    expect(
      resolveMediaIntent("Video degil, fotograf istiyorum", "video"),
    ).toMatchObject({ kind: "image" });
    expect(resolveMediaIntent("I do not want a video", "video")).toMatchObject({
      kind: "image",
      confidence: "strong",
    });
    expect(resolveMediaIntent("Gorsel istemiyorum", "image")).toMatchObject({
      kind: "video",
      confidence: "strong",
    });
  });

  it("preserves the selected model for an ambiguous prompt", () => {
    expect(
      resolveMediaRequest({
        purpose: "image",
        prompt: "A silver car at dusk",
        selectedModel: "video-kling",
      }),
    ).toMatchObject({
      kind: "video",
      confidence: "fallback",
      selectedModel: "video-kling",
      selectionChanged: false,
    });
  });

  it("overrides an image picker with the allowlisted video default", () => {
    expect(
      resolveMediaRequest({
        purpose: "image",
        prompt: "Turn this photo into a cinematic video",
        selectedModel: "image-gpt",
      }),
    ).toMatchObject({
      kind: "video",
      confidence: "explicit",
      selectedModel: "video-veo-fast",
      selectionChanged: true,
    });
  });

  it.each(["auto", "build-codex", "rift-pro"] as const)(
    "repairs an invalid Studio selection before resolving media: %s",
    (selectedModel) => {
      expect(
        resolveMediaRequest({
          purpose: "image",
          prompt: "A silver car at dusk",
          selectedModel,
        }),
      ).toMatchObject({
        kind: "image",
        selectedModel: "image-gemini",
        selectionChanged: true,
      });
    },
  );

  it("does not reinterpret prompts outside Media Studio", () => {
    expect(
      resolveMediaRequest({
        purpose: "app",
        prompt: "Build a video editor",
        selectedModel: "build-codex",
      }),
    ).toMatchObject({
      confidence: "fallback",
      selectedModel: "build-codex",
      selectionChanged: false,
    });
    expect(
      resolveMediaRequest({
        purpose: "app",
        prompt: "Build a video editor",
      }),
    ).toMatchObject({ selectedModel: "auto", selectionChanged: false });
  });
});
